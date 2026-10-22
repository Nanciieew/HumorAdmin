import "server-only";
import { getViewer } from "./auth/profile";

export async function galleryWriter(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Please log in and finish signup to continue." }, { status: 401 });
  return viewer;
}
export function galleryError(error: unknown, status = 400) {
  return Response.json({ error: error instanceof Error ? error.message : "Something went wrong. Please try again." }, { status });
}
