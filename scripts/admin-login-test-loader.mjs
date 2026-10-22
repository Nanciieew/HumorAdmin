import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/headers') return { url: 'admin-login-test:headers', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'admin-login-test:headers' || url.endsWith('/next/headers.js')) return {
      format: 'module', shortCircuit: true,
      source: 'export async function cookies() { return globalThis.__loginCookies; } export async function headers() { return globalThis.__loginHeaders; }',
    };
    return nextLoad(url, context);
  },
});
