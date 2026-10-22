// Request-scoped authentication and cache APIs for isolated endpoint tests.
// The real admin verifier still runs against this simulated user-scoped client.
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/auth/server') return { url: 'admin-test:auth', shortCircuit: true };
    if (specifier === 'next/cache') return { url: 'admin-test:cache', shortCircuit: true };
    if (specifier === 'next/navigation') return { url: 'admin-test:navigation', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'admin-test:auth' || url.endsWith('/lib/auth/server.ts')) return {
      format: 'module', shortCircuit: true,
      source: 'export async function createAuthClient() { return globalThis.__adminAuthClient; }',
    };
    if (url === 'admin-test:cache' || url.endsWith('/next/cache.js')) return {
      format: 'module', shortCircuit: true,
      source: 'export function revalidatePath(path) { (globalThis.__adminInvalidations ??= []).push(path); }',
    };
    if (url === 'admin-test:navigation' || url.endsWith('/next/navigation.js')) return {
      format: 'module', shortCircuit: true,
      source: 'export function redirect(path) { throw new Error("REDIRECT:" + path); } export function notFound() { throw new Error("NOT_FOUND"); }',
    };
    return nextLoad(url, context);
  },
});
