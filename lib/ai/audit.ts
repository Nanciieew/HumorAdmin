import "server-only";
import { createHash, randomUUID } from "node:crypto";

export type GenerationContext = {
  userId: string;
  source: string;
  workflow?: "live_roast" | "factory_captions" | "seedream_image" | "roast_meme";
  factoryBatchId?: string;
  externalRequestId?: string;
  sessionId?: string;
  stepPosition?: number;
  attempt?: number;
};
type AuditInput = { context: GenerationContext; provider: string; model: string; request: unknown };
type CapturedResponse = { response: unknown; httpStatus: number };

export async function readProviderResponse(response: Response, capture: (response: CapturedResponse) => void) {
  capture({ response: {}, httpStatus: response.status });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { data = { raw_text: raw }; }
  capture({ response: data, httpStatus: response.status });
  return data;
}

function attachment(base64: string, mimeType: unknown) {
  const bytes = Buffer.from(base64, "base64");
  return { mimeType, byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), content: "omitted" };
}

// Preserve prompts and settings; camera/image bytes are represented by fingerprints.
// Headers are never passed to this function. Thought parts are not public outputs.
export function auditPayload(value: unknown): unknown {
  if (typeof value === "string" && /^data:image\/[^;]+;base64,/.test(value)) {
    const [header, ...data] = value.split(",");
    return attachment(data.join(","), header.slice(5, header.indexOf(";")));
  }
  if (Array.isArray(value)) return value.filter(v => !(v && typeof v === "object" && v.thought === true)).map(auditPayload);
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  if (typeof input.mimeType === "string" && typeof input.data === "string" && input.mimeType.startsWith("image/")) return attachment(input.data, input.mimeType);
  return Object.fromEntries(Object.entries(input).map(([key, item]) => [key,
    /^(authorization|x-goog-api-key|api[_-]?key|access[_-]?token|secret|receipt)$/i.test(key) ? "[redacted]" : auditPayload(item),
  ]));
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { supabase } = await import("../supabase");
  try {
    const result = await supabase.rpc(name, args).abortSignal(AbortSignal.timeout(3000));
    if (result.error) throw new Error();
    return result.data;
  } catch { throw new Error("Generation logging is unavailable. Please try again later."); }
}

export async function auditedGeneration<T>(input: AuditInput, run: (capture: (response: CapturedResponse) => void) => Promise<T>): Promise<T> {
  const context = input.context;
  const id = randomUUID();
  await rpc("record_generation_start", { p_entry: {
    id, user_id: context.userId, source: context.source, workflow: context.workflow ?? "seedream_image",
    provider: input.provider, model: input.model, request: auditPayload(input.request),
    factory_batch_id: context.factoryBatchId ?? null, external_request_id: context.externalRequestId ?? null,
    session_id: context.sessionId ?? null, step_position: context.stepPosition ?? 0, attempt: context.attempt ?? 1,
  } });
  const started = performance.now();
  let captured: CapturedResponse = { response: {}, httpStatus: 0 };
  let result: T;
  let failed = false;
  let failure: unknown;
  try { result = await run(value => { captured = value; }); }
  catch (error) { failed = true; failure = error; }
  const cancelled = failure instanceof Error && ["AbortError", "TimeoutError"].includes(failure.name);
  await rpc("record_generation_finish", { p_id: id, p_result: {
    status: failed ? cancelled ? "cancelled" : "failed" : "succeeded",
    response: auditPayload(captured.response), http_status: captured.httpStatus || null,
    duration_ms: Math.round(performance.now() - started),
    // Do not retain arbitrary error strings which may contain URLs or credentials.
    error: failed ? { code: cancelled && failure instanceof Error ? failure.name : captured.httpStatus >= 400 ? `HTTP_${captured.httpStatus}` : "GENERATION_FAILED" } : null,
  } });
  if (failed) throw failure;
  return result!;
}
