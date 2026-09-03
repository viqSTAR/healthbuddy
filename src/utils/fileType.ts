import { AppError } from './AppError.js';

/**
 * What a file actually is, as opposed to what it claims to be.
 *
 * The uploaded type came from the client: multer reads it out of the
 * `Content-Type` header on the multipart part, which is a string the uploader
 * chose. The allowlist check against it was therefore checking the attacker's
 * own assertion — anything at all could be stored as `image/png` and streamed
 * back to the next viewer under that type.
 *
 * That was not immediately exploitable, because responses carry `nosniff` and a
 * `default-src 'none'` policy, so a browser handed HTML labelled as an image
 * refuses to render it as either. But the defence was entirely in the response
 * headers, and the store was accepting arbitrary bytes as clinical documents.
 * Reading the leading bytes moves the check to where the truth is.
 *
 * Deliberately not a general-purpose sniffer. Five formats are accepted, each
 * has a short unambiguous prefix, and a small explicit table is far easier to
 * be sure of than a dependency that recognises three hundred.
 */

type Sniffer = (buf: Buffer) => boolean;

const startsWith = (...bytes: number[]): Sniffer =>
  (buf) => buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);

/** RIFF....WEBP — the tag sits at offset 8, after the container length. */
const isWebp: Sniffer = (buf) =>
  buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';

/** ISO base media file with an `ftyp` box whose brand is a HEIF/HEIC one. */
const isHeic: Sniffer = (buf) => {
  if (buf.length < 12 || buf.toString('ascii', 4, 8) !== 'ftyp') return false;
  const brand = buf.toString('ascii', 8, 12);
  return ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'].includes(
    brand
  );
};

const SIGNATURES: Record<string, Sniffer> = {
  'image/jpeg': startsWith(0xff, 0xd8, 0xff),
  'image/png': startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  'image/webp': isWebp,
  'image/heic': isHeic,
  'application/pdf': startsWith(0x25, 0x50, 0x44, 0x46, 0x2d), // %PDF-
};

export const SUPPORTED_UPLOAD_TYPES = Object.keys(SIGNATURES);

/**
 * Confirms the bytes match the declared type, and returns the type to store.
 *
 * Throws 415 for both "we don't accept that" and "that isn't what you said it
 * was", with different messages: the first is a thing the uploader can fix by
 * converting the file, and the second usually means a renamed extension.
 */
export const assertDeclaredTypeMatchesBytes = (declared: string, buffer: Buffer): string => {
  const sniff = SIGNATURES[declared];
  if (!sniff) {
    throw new AppError(
      `Unsupported file type "${declared}". Upload a JPEG, PNG, WebP, HEIC or PDF.`,
      415
    );
  }

  if (!sniff(buffer)) {
    throw new AppError(
      `That file is not a valid ${declared}. Its contents do not match the format — ` +
        'renaming a file does not change what it is.',
      415
    );
  }

  return declared;
};
