import { NextResponse } from "next/server";

// User-facing pages remain on the original deployment. A full navigation also
// gets a fresh server read instead of a prefetched page from this deployment.
const destinations = new Set(["gallery", "my-works", "leaderboard", "you-are-a-joke", "quest"]);

export async function GET(request: Request, { params }: { params: Promise<{ userPath: string[] }> }) {
  const { userPath } = await params;
  if (!destinations.has(userPath[0])) return new Response("Not found", { status: 404 });
  const origin = process.env.USER_SITE_URL;
  if (!origin) return new Response("Configure USER_SITE_URL to open the original user site.", { status: 503 });
  const base = new URL(origin);
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.origin === new URL(request.url).origin) {
    return new Response("Invalid user site configuration.", { status: 503 });
  }
  const target = new URL(request.url);
  const response = NextResponse.redirect(new URL(target.pathname + target.search, base.origin), 307);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
