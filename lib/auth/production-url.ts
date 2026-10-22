type DeploymentEnvironment = {
  VERCEL_ENV?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
};

// Vercel's Visit button opens a unique deployment hostname. Start production
// browser sessions on the stable domain registered with Supabase so OAuth and
// its PKCE cookie use the same origin. API writes stay on their original origin.
export function productionPageRedirect(request: Request, environment: DeploymentEnvironment = {
  VERCEL_ENV: process.env.VERCEL_ENV,
  VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
}) {
  const hostname = environment.VERCEL_PROJECT_PRODUCTION_URL;
  if (environment.VERCEL_ENV !== "production" || !hostname ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(hostname) ||
      !["GET", "HEAD"].includes(request.method)) return null;

  const target = new URL(request.url);
  if (target.pathname === "/api" || target.pathname.startsWith("/api/") ||
      target.pathname === "/auth/callback" ||
      (target.hostname === hostname.toLowerCase() && target.protocol === "https:")) return null;

  target.protocol = "https:";
  target.host = hostname;
  target.port = "";
  return target;
}
