import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fixture.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fixture';
const { supabase } = await import('../lib/supabase.ts');
const callback = await import('../app/auth/callback/route.ts');
const denied = await import('../app/auth/access-denied/route.ts');
const { loginWithGoogle } = await import('../app/auth/actions.ts');
const { getAuthViewer } = await import('../lib/auth/profile.ts');
const { galleryWriter } = await import('../lib/gallery-http.ts');
const factoryRoute = await import('../app/api/factory/[id]/route.ts');

const id = '10000000-0000-4000-8000-000000000001';
const approved = { id, email: 'approved@example.com', email_confirmed_at: '2026-01-01', identities: [{ provider: 'google' }] };
let user, flag, permissionError, authError, exchangeError, signOutThrows, signOuts, elevatedReads, oauthOptions, cookieValues;
beforeEach(() => {
  user = structuredClone(approved); flag = true; permissionError = null; authError = null; exchangeError = null;
  signOutThrows = false; signOuts = []; elevatedReads = 0; oauthOptions = null;
  cookieValues = new Map([
    ['ego_return', '/admin/media?status=private'],
    ['sb-fixture-auth-token.0', 'session-fragment'],
    ['sb-fixture-auth-token-code-verifier', 'verifier'],
    ['sb-other-auth-token', 'unrelated-cookie'],
  ]);
  globalThis.__loginCookies = {
    get(name) { return cookieValues.has(name) ? { name, value: cookieValues.get(name) } : undefined; },
    getAll() { return [...cookieValues].map(([name, value]) => ({ name, value })); },
    set(name, value) { cookieValues.set(name, value); }, delete(name) { cookieValues.delete(name); },
  };
  globalThis.__loginHeaders = new Headers({ origin: 'https://admin.example' });
  globalThis.__adminAuthClient = {
    auth: {
      async getUser() { return { data: { user }, error: authError }; },
      async exchangeCodeForSession() { return { error: exchangeError }; },
      async signOut(options) { signOuts.push(options); if (signOutThrows) throw new Error('Provider unavailable'); user = null; return { error: null }; },
      async signInWithOAuth(options) { oauthOptions = options; return { data: { url: 'https://accounts.google.test/authorize' }, error: null }; },
    },
    from(table) {
      assert.equal(table, 'profiles');
      return { select(columns) { assert.equal(columns, 'is_superadmin'); return this; }, eq(column, value) { assert.equal(column, 'id'); assert.equal(value, user.id); return this; }, async maybeSingle() { return { data: flag === null ? null : { is_superadmin: flag }, error: permissionError }; } };
    },
  };
  supabase.from = table => {
    elevatedReads++; assert.equal(table, 'profiles');
    return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { id, is_superadmin: true, onboarding_completed_at: '2026-01-01' }, error: null }; } };
  };
});
const callbackRequest = () => new Request('https://admin.example/auth/callback?code=example');

test('approved confirmed Google accounts keep their session and return to the requested admin page', async () => {
  await assert.rejects(callback.GET(callbackRequest()), error => error.message === 'REDIRECT:/admin/media?status=private');
  assert.equal(signOuts.length, 0); assert.equal(elevatedReads, 1); assert.equal(cookieValues.has('ego_return'), false);
  assert.equal(cookieValues.has('sb-fixture-auth-token.0'), true);
});
test('unapproved accounts cannot finish login or access elevated profile reads and are signed out locally', async () => {
  for (const permission of [false, null, 'true']) {
    flag = permission;
    await assert.rejects(callback.GET(callbackRequest()), /REDIRECT:\/login\?error=access_denied/);
    assert.deepEqual(signOuts.at(-1), { scope: 'local' }); assert.equal(elevatedReads, 0);
    assert.equal(cookieValues.has('sb-fixture-auth-token.0'), false); assert.equal(cookieValues.has('sb-fixture-auth-token-code-verifier'), false);
    assert.equal(cookieValues.has('ego_return'), false); assert.equal(cookieValues.has('sb-other-auth-token'), true);
    user = structuredClone(approved);
  }
});
test('unconfirmed email, non-Google identities and spoofed metadata never authorize login', async () => {
  for (const candidate of [{ ...approved, email_confirmed_at: null }, { ...approved, identities: [{ provider: 'email' }] }, { ...approved, user_metadata: { is_superadmin: true } }]) {
    user = candidate; flag = candidate.user_metadata ? false : true;
    await assert.rejects(callback.GET(callbackRequest()), /error=access_denied/); assert.equal(elevatedReads, 0);
  }
});
test('permission lookup failures deny login, clear cookies even if sign-out fails, and show a retryable error', async () => {
  permissionError = { code: 'unavailable' }; signOutThrows = true;
  await assert.rejects(callback.GET(callbackRequest()), /error=verification/);
  assert.equal(elevatedReads, 0); assert.equal(cookieValues.has('sb-fixture-auth-token.0'), false);
});
test('failed OAuth exchange never enters the app', async () => {
  exchangeError = { message: 'Invalid code' };
  await assert.rejects(callback.GET(callbackRequest()), /REDIRECT:\/login\?error=oauth/);
  assert.equal(elevatedReads, 0); assert.equal(cookieValues.has('sb-fixture-auth-token.0'), false);
});
test('revoked existing sessions are cleared, while approved users cannot be logged out through the denied route', async () => {
  const request = new Request('https://admin.example/auth/access-denied?next=%2Fadmin%2Fusers');
  await assert.rejects(denied.GET(request), error => error.message === 'REDIRECT:/admin/users');
  assert.equal(signOuts.length, 0);
  flag = false;
  await assert.rejects(denied.GET(request), /error=access_denied/);
  assert.deepEqual(signOuts, [{ scope: 'local' }]); assert.equal(cookieValues.has('sb-fixture-auth-token.0'), false);
});
test('unsafe post-login destinations cannot redirect an approved account to another site', async () => {
  cookieValues.set('ego_return', '//evil.example');
  await assert.rejects(callback.GET(callbackRequest()), error => error.message === 'REDIRECT:/');
});
test('non-admin sessions cannot hydrate profiles, mutate Factory, or read private Factory previews', async () => {
  flag = false;
  assert.equal(await getAuthViewer(), null); assert.equal(elevatedReads, 0);
  const request = new Request('https://admin.example/api/factory', { method: 'POST', headers: { origin: 'https://admin.example' } });
  const deniedWrite = await galleryWriter(request); assert.equal(deniedWrite.status, 403);
  const deniedRead = await factoryRoute.GET(new Request('https://admin.example/api/factory/' + id), { params: Promise.resolve({ id }) });
  assert.equal(deniedRead.status, 403); assert.equal(deniedRead.headers.get('cache-control'), 'private, no-store'); assert.equal(elevatedReads, 0);
  permissionError = {};
  assert.equal((await galleryWriter(request)).status, 503);
});
test('Google sign-in asks for an account choice, retains a safe return path and uses this app callback', async () => {
  const form = new FormData(); form.set('next', '/disguise');
  await assert.rejects(loginWithGoogle({}, form), /REDIRECT:https:\/\/accounts.google.test\/authorize/);
  assert.equal(cookieValues.get('ego_return'), '/disguise'); assert.equal(oauthOptions.provider, 'google');
  assert.equal(oauthOptions.options.redirectTo, 'https://admin.example/auth/callback');
  assert.deepEqual(oauthOptions.options.queryParams, { prompt: 'select_account' });
});
