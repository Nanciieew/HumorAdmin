import { ImageGenerationError } from "@/lib/seedream-generation";
import { AdminError } from "@/lib/admin/auth";
export function factoryError(error: unknown) {
  const timeout = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
  const known = error instanceof ImageGenerationError || error instanceof AdminError;
  return Response.json({ error: known ? error.message : timeout ? "Generation timed out. Please try again." : "The factory couldn’t finish this request. Please try again." }, { status: known ? error.status : timeout ? 504 : 503, headers: { "Cache-Control": "private, no-store" } });
}
