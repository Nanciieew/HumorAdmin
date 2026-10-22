import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { returnPath, adminReturnPath } from '../lib/auth/return-path.ts';
import { GET } from '../app/[...userPath]/route.ts';

const original = process.env.USER_SITE_URL;
afterEach(() => {
  if (original === undefined) delete process.env.USER_SITE_URL;
  else process.env.USER_SITE_URL = original;
});
test('OAuth return paths reject external redirects and retain admin and factory destinations', () => {
  for (const unsafe of ['//evil.test/admin', 'https://evil.test/admin', '/admin\\evil', '/admin\r\n', null, '/' + 'a'.repeat(500)]) {
    assert.equal(returnPath(unsafe), '/');
    assert.equal(adminReturnPath(unsafe), null);
  }
  assert.equal(returnPath('/disguise/preview'), '/disguise/preview');
  assert.equal(adminReturnPath('/admin/media?page=2'), '/admin/media?page=2');
});
test('user-site bridge preserves gallery filters and owned-work paths without caching redirects', async () => {
  process.env.USER_SITE_URL = 'https://original.example';
  for (const path of ['/gallery?sort=newest', '/my-works/20000000-0000-4000-8000-000000000001']) {
    const response = await GET(new Request('https://admin.example' + path), { params: Promise.resolve({ userPath: path.split('?')[0].slice(1).split('/') }) });
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('Location'), 'https://original.example' + path);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
});
test('user-site bridge refuses unknown destinations, missing config and redirect loops', async () => {
  const context = name => ({ params: Promise.resolve({ userPath: [name] }) });
  const request = name => new Request('https://admin.example/' + name);
  assert.equal((await GET(request('missing'), context('missing'))).status, 404);
  delete process.env.USER_SITE_URL;
  assert.equal((await GET(request('gallery'), context('gallery'))).status, 503);
  for (const origin of ['https://admin.example', 'ftp://original.example', 'https://user:pass@original.example']) {
    process.env.USER_SITE_URL = origin;
    assert.equal((await GET(request('gallery'), context('gallery'))).status, 503);
  }
});
