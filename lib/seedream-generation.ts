import "server-only";
import { SEEDREAM_MODEL } from "./seedream";
import { validateSeedreamReference } from "./seedream-reference";
import { saveGeneratedImage } from "./gallery-media";

export class ImageGenerationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export async function generateSeedreamImage(userId: string, input: unknown, signal?: AbortSignal) {
  const body = input as { prompt?: string; image?: unknown; purpose?: string; approved?: boolean } | null;
  if (typeof body?.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 4000) throw new ImageGenerationError("Enter a prompt between 1 and 4,000 characters.");
  if (body.purpose !== undefined && body.purpose !== "disguise") throw new ImageGenerationError("Choose a valid generation mode.");
  const disguise = body.purpose === "disguise";
  if (disguise && (body.approved !== true || body.image === undefined)) throw new ImageGenerationError("Choose your selfie and agree to send it to Doubao first.");
  let image: string | undefined;
  if (body.image !== undefined) {
    const validated = await validateSeedreamReference(body.image);
    if (!validated) throw new ImageGenerationError("Choose a valid, non-animated JPG or PNG selfie up to 2 MB and 24 megapixels.");
    image = validated;
  }
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) throw new ImageGenerationError("Image generation is not configured. Add ARK_API_KEY to the server environment.", 503);
  const prompt = disguise
    ? `Transform the person in the reference photo into an animated-film or illustrated character. Preserve recognizable facial features, expression and hairstyle. Create a single finished character portrait, without captions or a collage. Follow this creative direction: ${body.prompt.trim()}`
    : body.prompt.trim();
  const url = await generateSeedreamOutput(prompt, image, signal);
  const saved = await saveGeneratedImage(userId, url);
  return { ...saved, model: SEEDREAM_MODEL };
}

// Raw model output is used by the factory’s private, expiring variant cache.
export async function generateSeedreamOutput(prompt: string, image?: string, signal?: AbortSignal) {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) throw new ImageGenerationError("Image generation is not configured.", 503);
  const timeout = AbortSignal.timeout(150_000);
  const response = await fetch("https://ark.cn-beijing.volces.com/api/v3/images/generations", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: SEEDREAM_MODEL, prompt, ...(image ? { image } : {}), size: "2K", response_format: "url", watermark: true }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout, cache: "no-store",
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    const message = failure?.error?.code === "SetLimitExceeded"
      ? "The image provider’s account usage limit has been reached. The site owner needs to adjust it in Ark before generation can continue."
      : response.status === 401 || response.status === 403 ? "Ark rejected access. Check the server API key and model permissions."
      : response.status === 429 ? "Ark is busy or your quota is exhausted. Please try again later."
      : "Ark could not generate this image. Try a different prompt or try again later.";
    throw new ImageGenerationError(message, 502);
  }
  const result = await response.json();
  const url = result.data?.[0]?.url;
  let valid = false;
  try { valid = typeof url === "string" && new URL(url).protocol === "https:"; } catch { /* Invalid provider URL. */ }
  if (!valid) throw new ImageGenerationError("The model returned no usable image. Please try again.", 502);
  return url as string;
}
