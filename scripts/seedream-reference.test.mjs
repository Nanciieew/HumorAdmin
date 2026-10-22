import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { validateSeedreamReference } from '../lib/seedream-reference.ts';

test('accepts JPEG and PNG reference photos', async () => {
  for (const format of ['jpeg', 'png']) {
    const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ffffff' } }).toFormat(format).toBuffer();
    const url = `data:image/${format};base64,${bytes.toString('base64')}`;
    assert.equal(await validateSeedreamReference(url), url);
  }
});

test('rejects external URLs, malformed data, mismatched formats and oversized references', async () => {
  const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ffffff' } }).png().toBuffer();
  for (const value of [undefined, 'https://example.com/photo.png', 'data:image/png;base64,AAAA', `data:image/jpeg;base64,${bytes.toString('base64')}`, `data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')}`]) {
    assert.equal(await validateSeedreamReference(value), null);
  }
});

test('rejects reference photos outside supported dimensions', async () => {
  for (const [width, height] of [[14, 32], [6001, 15], [5000, 5000]]) {
    const bytes = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).png().toBuffer();
    assert.equal(await validateSeedreamReference(`data:image/png;base64,${bytes.toString('base64')}`), null);
  }
});
