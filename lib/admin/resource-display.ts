export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function display(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
export function label(name: string) {
  const labels: Record<string, string> = { workflow_key: "Workflow", duration_ms: "Duration", http_status: "HTTP status", response: "Output", created_at: "Created", completed_at: "Completed", llm_model_id: "Model ID", request_id: "Generation request ID", generation_request_id: "Legacy Factory batch ID" };
  return labels[name] ?? name.replaceAll("_", " ").replace(/^./, first => first.toUpperCase());
}
export function date(value: unknown) {
  if (typeof value !== "string") return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
}
function parts(value: unknown) {
  if (!Array.isArray(value)) return "";
  return value.map(record).filter(part => part.thought !== true && typeof part.text === "string").map(part => part.text).join("\n");
}
export function requestPrompts(value: unknown) {
  const input = record(value);
  return {
    system: parts(record(input.systemInstruction).parts),
    user: typeof input.prompt === "string" ? input.prompt : Array.isArray(input.contents) ? input.contents.map(record).map(content => parts(content.parts)).filter(Boolean).join("\n\n") : "",
    settings: input.generationConfig,
  };
}
export function providerOutput(value: unknown): string {
  if (typeof value === "string") return value;
  const output = record(value);
  if (Array.isArray(output.candidates)) {
    const text = output.candidates.map(record).map(candidate => parts(record(candidate.content).parts)).filter(Boolean).join("\n\n");
    if (text) return text;
  }
  if (typeof output.raw_text === "string") return output.raw_text;
  if (Array.isArray(output.data)) {
    const urls = output.data.map(record).map(item => item.url).filter(url => typeof url === "string");
    if (urls.length) return urls.join("\n");
  }
  return display(value);
}
