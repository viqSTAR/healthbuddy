import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile, stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import path from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import { AppError } from './AppError.js';

/**
 * File storage for licence documents, lab reports and prescription images.
 *
 * Everything here is addressed by an opaque `storageKey`. A key is never a URL
 * and is never publicly reachable: reads go through an authorisation check in
 * documentService, then either an authenticated stream or a short-lived signed
 * link minted by `signKey` below.
 *
 * The alternative — putting reports in a public bucket and storing the URL —
 * means anyone who obtains or guesses that URL reads a patient's results with
 * no login at all.
 */
export interface StorageDriver {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  read(key: string): Promise<Readable>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/** Rejects traversal and absolute paths before a key ever touches the disk. */
const assertSafeKey = (key: string): void => {
  if (!key || key.includes('..') || path.isAbsolute(key) || /[\0\\]/.test(key)) {
    throw new AppError('Invalid storage key.', 400);
  }
};

const localDriver = (): StorageDriver => {
  const root = path.resolve(env.UPLOAD_DIR);

  const resolve = (key: string): string => {
    assertSafeKey(key);
    const full = path.resolve(root, key);
    // Belt and braces: even with a sanitised key, refuse anything that escapes.
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new AppError('Invalid storage key.', 400);
    }
    return full;
  };

  return {
    name: 'local',

    async put(key, body, _contentType) {
      const full = resolve(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, body);
    },

    async read(key) {
      const full = resolve(key);
      try {
        await stat(full);
      } catch {
        throw new AppError('Stored file is no longer available.', 404);
      }
      return createReadStream(full);
    },

    async remove(key) {
      try {
        await unlink(resolve(key));
      } catch {
        /* already gone — deleting is idempotent */
      }
    },

    async exists(key) {
      try {
        await stat(resolve(key));
        return true;
      } catch {
        return false;
      }
    },
  };
};

/**
 * Durable object storage over the S3 API. Cloudflare R2 speaks that API, so one
 * driver covers both — R2 only differs in the endpoint (an account-scoped host)
 * and the region, which is always the literal string "auto".
 *
 * Objects stay **private**. R2 can expose a bucket on a public r2.dev domain and
 * that is precisely what must not happen here: a public URL to a lab report is
 * readable by anyone who obtains it, forever, with no login. Reads are streamed
 * back through the API after documentService has authorised the caller.
 */
const objectDriver = (label: string): StorageDriver => {
  const bucket = env.S3_BUCKET!;

  const endpoint = env.R2_ACCOUNT_ID
    ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : env.S3_ENDPOINT;

  const client = new S3Client({
    region: env.S3_REGION ?? (env.R2_ACCOUNT_ID ? 'auto' : undefined),
    endpoint,
    // R2 needs path-style addressing against the account endpoint; on real S3
    // it is equivalent, so one setting serves both.
    forcePathStyle: Boolean(endpoint),
    credentials:
      env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
        : undefined,
    /**
     * The SDK began sending CRC32 checksums by default in v3.729, which R2
     * rejects outright with "Header 'x-amz-checksum-crc32' ... not implemented".
     * WHEN_REQUIRED restores the previous behaviour. Harmless on AWS, so it is
     * set unconditionally rather than branching on the provider.
     */
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  /** Turns a driver-level failure into something the API layer can render. */
  const wrap = async <T>(key: string, op: () => Promise<T>): Promise<T> => {
    assertSafeKey(key);
    try {
      return await op();
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') {
        throw new AppError('Stored file is no longer available.', 404);
      }
      // Credentials, bucket and network problems are ours, not the caller's.
      throw new AppError('File storage is unavailable right now.', 503);
    }
  };

  return {
    name: label,

    put: (key, body, contentType) =>
      wrap(key, async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            // Belt and braces against a bucket that was made public by mistake.
            CacheControl: 'private, no-store',
          })
        );
      }),

    read: (key) =>
      wrap(key, async () => {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!res.Body) throw new AppError('Stored file is no longer available.', 404);
        return res.Body as Readable;
      }),

    remove: (key) =>
      wrap(key, async () => {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      }).catch(() => undefined), // deleting is idempotent

    async exists(key) {
      try {
        assertSafeKey(key);
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    },
  };
};

export const storage: StorageDriver =
  env.STORAGE_DRIVER === 'local' ? localDriver() : objectDriver(env.STORAGE_DRIVER);

/** Groups uploads by owner so a key is never guessable from the document id. */
export const buildStorageKey = (ownerUserId: string, fileName: string): string => {
  const ext = path.extname(fileName).toLowerCase().slice(0, 10).replace(/[^a-z0-9.]/g, '');
  return `${ownerUserId}/${randomUUID()}${ext}`;
};

/* ---------- Short-lived signed links ---------- */

const linkSecret = env.JWT_ACCESS_SECRET;

/**
 * Mints `<expiryEpochSeconds>.<signature>` for a document id. Used where a bare
 * URL is unavoidable (an <img> tag in the admin panel, a PDF viewer). The
 * authorisation decision happens when the link is minted, not when it is used,
 * so the TTL is deliberately short.
 */
export const signDocumentLink = (documentId: string, ttlSeconds = env.FILE_LINK_TTL_SECONDS) => {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = createHmac('sha256', linkSecret)
    .update(`${documentId}.${expiresAt}`)
    .digest('hex');
  return { token: `${expiresAt}.${signature}`, expiresAt };
};

export const verifyDocumentLink = (documentId: string, token: string): boolean => {
  const [rawExpiry, signature] = token.split('.');
  if (!rawExpiry || !signature) return false;

  const expiresAt = Number(rawExpiry);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;

  const expected = createHmac('sha256', linkSecret)
    .update(`${documentId}.${expiresAt}`)
    .digest('hex');

  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};
