import "server-only";
import { getViewer } from "./auth/profile";
import { AdminError, requireAdmin } from "./admin/auth";
import { adminJson } from "./admin/http";

export async function galleryWriter(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    await requireAdmin();
    const viewer = await getViewer();
    if (!viewer) return adminJson({ error: "Complete your admin profile to continue." }, 401);
    return viewer;
  } catch (error) {
    return adminJson({ error: error instanceof AdminError ? error.message : "Unable to verify admin access." }, error instanceof AdminError ? error.status : 503);
  }
}
export function galleryError(error: unknown, status = 400) {
  return Response.json({ error: error instanceof Error ? error.message : "Something went wrong. Please try again." }, { status });
}
