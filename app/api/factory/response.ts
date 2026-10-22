import { ImageGenerationError } from "@/lib/seedream-generation";
export function factoryError(error: unknown) {
  const timeout = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
  return Response.json({ error: error instanceof ImageGenerationError ? error.message : timeout ? "Generation timed out. Please try again." : "The factory couldn’t finish this request. Please try again." }, { status: error instanceof ImageGenerationError ? error.status : timeout ? 504 : 503, headers: { "Cache-Control": "private, no-store" } });
}
