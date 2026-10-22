import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { returnPath, adminReturnPath } from '../lib/auth/return-path.ts';
import { GET } from '../app/[...userPath]/route.ts';
import { productionPageRedirect } from '../lib/auth/production-url.ts';
import { proxy } from '../proxy.ts';
import { NextRequest } from 'next/server';

const original = process.env.USER_SITE_URL;
const originalVercelEnvironment = process.env.VERCEL_ENV;
const originalProductionHostname = process.env.VERCEL_PROJECT_PRODUCTION_URL;
afterEach(() => {
  if (original === undefined) delete process.env.USER_SITE_URL;
  else process.env.USER_SITE_URL = original;
  for (const [key, value] of [['VERCEL_ENV', originalVercelEnvironment], ['VERCEL_PROJECT_PRODUCTION_URL', originalProductionHostname]]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const production = { VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'humoradmin-nine.vercel.app' };
test('Vercel production Visit links redirect before auth while retaining the requested admin path and filters', async () => {
  Object.assign(process.env, production);
  const response = await proxy(new NextRequest('https://humoradmin-unique.vercel.app/admin/media?status=private&page=2'));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('Location'), 'https://humoradmin-nine.vercel.app/admin/media?status=private&page=2');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});
test('production login and Factory entry links use the stable OAuth origin', () => {
  for (const path of ['/', '/login?next=%2Fdisguise%2Fpreview', '/disguise/preview']) {
    const redirected = productionPageRedirect(new Request('https://humoradmin-unique.vercel.app' + path, { method: 'HEAD' }), production);
    assert.equal(redirected.href, 'https://humoradmin-nine.vercel.app' + path);
  }
});
test('canonical redirects leave API requests, writes, existing callbacks, stable hosts and non-production environments alone', () => {
  for (const path of ['/api', '/api/admin/media', '/api/factory', '/auth/callback?code=example']) {
    assert.equal(productionPageRedirect(new Request('https://humoradmin-unique.vercel.app' + path), production), null);
  }
  assert.equal(productionPageRedirect(new Request('https://humoradmin-unique.vercel.app/login', { method: 'POST' }), production), null);
  assert.equal(productionPageRedirect(new Request('https://humoradmin-nine.vercel.app/admin'), production), null);
  for (const environment of [{}, { ...production, VERCEL_ENV: 'preview' }, { ...production, VERCEL_ENV: 'development' }]) {
    assert.equal(productionPageRedirect(new Request('http://localhost:3001/login'), environment), null);
  }
});
test('redirect destinations come only from a valid trusted deployment hostname', () => {
  for (const hostname of ['', 'https://evil.example', 'user@evil.example', 'evil.example/path', 'evil.example?next=x', 'evil.example:444']) {
    assert.equal(productionPageRedirect(new Request('https://humoradmin-unique.vercel.app/login'), { ...production, VERCEL_PROJECT_PRODUCTION_URL: hostname }), null);
  }
  const target = productionPageRedirect(new Request('https://humoradmin-unique.vercel.app//other.example/login'), production);
  assert.equal(target.origin, 'https://humoradmin-nine.vercel.app');
  assert.equal(target.pathname, '//other.example/login');
});
test('OAuth return paths reject external redirects and retain admin and factory destinations', () => {
  for (const unsafe of ['//evil.test/admin', 'https://evil.test/admin', '/admin\\evil', '/admin\r\n', null, '/' + 'a'.repeat(500)]) {
    assert.equal(returnPath(unsafe), '/');
    assert.equal(adminReturnPath(unsafe), null);
  }
  assert.equal(returnPath('/disguise/preview'), '/disguise/preview');
  assert.equal(adminReturnPath('/admin/media?page=2'), '/admin/media?page=2');
});
test('user-site bridge preserves owned-work paths without caching redirects', async () => {
  process.env.USER_SITE_URL = 'https://original.example';
  for (const path of ['/my-works?sort=newest', '/my-works/20000000-0000-4000-8000-000000000001']) {
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
  assert.equal((await GET(request('gallery'), context('gallery'))).status, 404);
  delete process.env.USER_SITE_URL;
  assert.equal((await GET(request('my-works'), context('my-works'))).status, 503);
  for (const origin of ['https://admin.example', 'ftp://original.example', 'https://user:pass@original.example']) {
    process.env.USER_SITE_URL = origin;
    assert.equal((await GET(request('my-works'), context('my-works'))).status, 503);
  }
});
