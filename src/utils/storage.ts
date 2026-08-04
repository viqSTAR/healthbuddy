import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, unlink, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
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
  read(key: string): Promise<ReadStream>;
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
 * Placeholder for durable object storage. Deliberately throws rather than
 * silently degrading to local disk: a production process that thinks it is
 * writing to S3 but is writing to an ephemeral container filesystem loses
 * every uploaded licence and lab report on the next redeploy.
 *
 * To implement: add `@aws-sdk/client-s3`, and back put/read/remove with
 * PutObject/GetObject/DeleteObject against `env.S3_BUCKET`.
 */
const s3Driver = (): StorageDriver => {
  const unimplemented = (): never => {
    throw new AppError(
      'STORAGE_DRIVER=s3 is configured but the S3 driver is not implemented yet. Install @aws-sdk/client-s3 and complete src/utils/storage.ts.',
      500
    );
  };

  return {
    name: 's3',
    put: unimplemented,
    read: unimplemented,
    remove: unimplemented,
    exists: unimplemented,
  };
};

export const storage: StorageDriver = env.STORAGE_DRIVER === 's3' ? s3Driver() : localDriver();

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
