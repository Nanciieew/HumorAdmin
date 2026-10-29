import "server-only";
import { factoryInstruction } from "../ai/prompts";
import { auditedGeneration, readProviderResponse, type GenerationContext } from "../ai/audit";
import { ImageGenerationError } from "../seedream-generation";

export function parseCaptions(value: unknown): string[] {
  const captions = (value as { captions?: unknown } | null)?.captions;
  if (!Array.isArray(captions) || captions.length !== 5 || captions.some(text => typeof text !== "string" || !text.trim() || text.trim().length > 180)) {
    throw new ImageGenerationError("The caption model didn’t return five usable captions. Please try again.", 502);
  }
  const clean = captions.map(text => text.trim());
  if (new Set(clean.map(text => text.toLocaleLowerCase())).size !== 5) throw new ImageGenerationError("The caption model repeated itself. Please try again.", 502);
  return clean;
}
export async function generateMemeCaptions(image: string, direction: string, signal: AbortSignal | undefined, shorter: boolean, context: GenerationContext) {
  const key = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL;
  if (!key || !model || !/^[a-zA-Z0-9._-]+$/.test(model)) throw new ImageGenerationError("Caption generation is not configured.", 503);
  const match = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(image)!;
  const payload = {
    systemInstruction: { parts: [{ text: factoryInstruction }] },
    contents: [{ role: "user", parts: [{ text: JSON.stringify({ direction, ...(shorter ? { revision: "The previous captions did not fit the fixed font or text area. Write five sharper captions, each 4–8 English words with ordinary punctuation. Do not use emoji or unsupported symbols." } : {}) }) }, { inlineData: { mimeType: match[1], data: match[2] } }] }],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: { type: "object", properties: { captions: { type: "array", items: { type: "string" }, minItems: 5, maxItems: 5 } }, required: ["captions"], additionalProperties: false }, maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: "low" } },
  };
  return auditedGeneration({ context, provider: "Google Gemini", model, request: payload }, async capture => {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
      body: JSON.stringify(payload),
    });
    const data = await readProviderResponse(response, capture);
    if (!response.ok) throw new ImageGenerationError(response.status === 429 ? "The caption provider is busy or its quota is exhausted. Please try again later." : "Couldn’t generate captions. Please try again.", 502);
    const text = (data.candidates?.[0]?.content?.parts ?? []).filter((part: { thought?: boolean }) => !part.thought).map((part: { text?: string }) => part.text ?? "").join("");
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new ImageGenerationError("The caption model returned an unreadable response. Please try again.", 502); }
    return parseCaptions(parsed);
  });
}
