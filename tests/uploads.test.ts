import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { app, prisma, request, login, cleanupTestUsers } from './helpers.js';
import { cacheStore } from '../src/config/redis.js';

/**
 * An upload is bytes plus a claim about them, and only one of those is
 * trustworthy.
 *
 * The type check used to run against the `Content-Type` on the multipart part,
 * which the uploader writes. So "is this an allowed format?" was really "does
 * the uploader say it is?", and any content at all could be stored as a lab
 * report and streamed back to a doctor under an image type.
 */

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

const upload = (token: string, body: Buffer, filename: string, contentType: string) =>
  request(app)
    .post('/api/v1/files')
    .set('Authorization', `Bearer ${token}`)
    .field('kind', 'PROFILE_PHOTO')
    .attach('file', body, { filename, contentType });

describe('uploads are checked against their contents', () => {
  test('a real PNG is accepted', async () => {
    const user = await login();
    const res = await upload(user.accessToken, PNG, 'photo.png', 'image/png');

    assert.equal(res.status, 201);
    assert.equal(res.body.document.mimeType, 'image/png');
    // The storage key never leaves the server — documents are addressed by id.
    assert.equal(res.body.document.storageKey, undefined);
  });

  test('a real PDF is accepted', async () => {
    const user = await login();
    assert.equal((await upload(user.accessToken, PDF, 'licence.pdf', 'application/pdf')).status, 201);
  });

  test('HTML wearing a PNG content type is refused', async () => {
    const user = await login();
    const html = Buffer.from('<html><script>fetch("https://evil.test")</script></html>');

    const res = await upload(user.accessToken, html, 'photo.png', 'image/png');

    assert.equal(res.status, 415);
    assert.match(res.body.error, /not a valid image\/png/i);
  });

  test('a PDF renamed as a JPEG is refused', async () => {
    const user = await login();
    const res = await upload(user.accessToken, PDF, 'scan.jpg', 'image/jpeg');
    assert.equal(res.status, 415);
  });

  test('a JPEG honestly declared is accepted, so the check is not just rejecting everything', async () => {
    const user = await login();
    assert.equal((await upload(user.accessToken, JPEG, 'scan.jpg', 'image/jpeg')).status, 201);
  });

  test('an executable is refused whatever it claims to be', async () => {
    const user = await login();
    const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64)]);

    assert.equal((await upload(user.accessToken, elf, 'x.png', 'image/png')).status, 415);
    assert.equal(
      (await upload(user.accessToken, elf, 'x.bin', 'application/octet-stream')).status,
      415
    );
  });

  test('an unauthenticated upload is refused', async () => {
    const res = await request(app)
      .post('/api/v1/files')
      .field('kind', 'PROFILE_PHOTO')
      .attach('file', PNG, { filename: 'photo.png', contentType: 'image/png' });

    assert.equal(res.status, 401);
  });
});

describe('a rejected upload leaves nothing behind', () => {
  test('no document row is written for a refused file', async () => {
    const user = await login();
    const html = Buffer.from('<html>not an image</html>');

    await upload(user.accessToken, html, 'photo.png', 'image/png');

    const count = await prisma.document.count({ where: { ownerUserId: user.userId } });
    assert.equal(count, 0);
  });
});

after(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
  await cacheStore.disconnect();
});
