// Shared, explicit resource definitions. Never derive table or column names from input.
export type ResourceField = { name: string; label: string; type?: "text" | "longtext" | "uuid" | "number" | "boolean" | "json" | "email" | "domain" | "url"; required?: boolean; max?: number; min?: number };
export type ResourceRelation = { key: string; table: string; column: string; label: string; display: string; resource: string; columns: string[] };
export type ResourceFilter = { column: string; label: string; kind?: "uuid" | "text" | "enum"; options?: string[] };
export type AdminResource = { slug: string; label: string; table: string; mode: "read" | "update" | "crud"; description: string; fields: ResourceField[]; columns: string[]; search?: string; filter?: string; readColumns?: string[]; relations?: ResourceRelation[]; filters?: ResourceFilter[]; emptyMessage?: string };
const definitions: AdminResource[] = [
  { slug: "prompt-chains", label: "Prompt chains", table: "prompt_chains", mode: "read", description: "Inspect prompt chains and open their ordered steps and mix entries.", fields: [], columns: ["id", "name", "description", "workflow_key", "created_at"], search: "name" },
  { slug: "prompt-chain-steps", label: "Prompt chain steps", table: "prompt_chain_steps", mode: "read", description: "Inspect each prompt, model, and position in a chain.", fields: [], columns: ["id", "prompt_chain_id", "position", "name", "llm_model_id", "system_prompt", "user_prompt", "created_at"], search: "name", filter: "prompt_chain_id" },
  { slug: "prompt-chain-mix", label: "Prompt chain mix", table: "prompt_chain_mix", mode: "update", description: "Adjust the weight and enabled state of existing chain mix entries. Weights are relative catalog values; the current Factory uses its deployed caption workflow.", fields: [{ name: "weight", label: "Weight", type: "number", required: true, min: 0 }, { name: "enabled", label: "Enabled", type: "boolean", required: true }], columns: ["id", "prompt_chain_id", "weight", "enabled", "created_at"], filter: "prompt_chain_id" },
  { slug: "terms", label: "Terms", table: "terms", mode: "crud", description: "Maintain the vocabulary and definitions available to your team.", fields: [{ name: "term", label: "Term", required: true, max: 200 }, { name: "definition", label: "Definition", type: "longtext", required: true, max: 10000 }], columns: ["id", "term", "definition", "created_at"], search: "term" },
  { slug: "generation-requests", label: "Generation requests", table: "generation_requests", mode: "read", description: "AI calls from GetChecked and the admin app, including prompts, model, selected step, mix snapshot, and outcome. Historical rows contain only information previously retained.", fields: [], columns: ["id", "user_id", "source", "status", "provider", "model", "attempt", "factory_batch_id", "external_request_id", "session_id", "llm_model_id", "prompt_chain_id", "prompt_chain_step_id", "request", "prompt_snapshot", "mix_snapshot", "error", "created_at", "completed_at"], filter: "user_id" },
  { slug: "ai-generation-examples", label: "AI generation examples", table: "ai_generation_examples", mode: "crud", description: "Manage example prompts and expected outputs, optionally linked to a chain or saved image.", fields: [{ name: "name", label: "Name", required: true, max: 200 }, { name: "prompt", label: "Prompt", type: "longtext", required: true, max: 10000 }, { name: "output", label: "Expected output", type: "longtext", required: true, max: 10000 }, { name: "prompt_chain_id", label: "Prompt chain ID", type: "uuid" }, { name: "image_id", label: "Image ID", type: "uuid" }], columns: ["id", "name", "prompt", "output", "prompt_chain_id", "image_id", "created_at"], search: "name" },
  { slug: "llm-models", label: "LLM models", table: "llm_models", mode: "crud", description: "Maintain model metadata and provider links. Factory continues to use its deployed model configuration.", fields: [{ name: "name", label: "Name", required: true, max: 200 }, { name: "model_id", label: "Provider model identifier", required: true, max: 200 }, { name: "llm_provider_id", label: "Provider ID", type: "uuid", required: true }, { name: "enabled", label: "Enabled", type: "boolean", required: true }], columns: ["id", "name", "model_id", "llm_provider_id", "enabled", "created_at"], search: "name" },
  { slug: "llm-providers", label: "LLM providers", table: "llm_providers", mode: "crud", description: "Maintain provider metadata. API credentials stay in server environment variables.", fields: [{ name: "name", label: "Name", required: true, max: 200 }, { name: "base_url", label: "Base URL", type: "url" }, { name: "enabled", label: "Enabled", type: "boolean", required: true }], columns: ["id", "name", "base_url", "enabled", "created_at"], search: "name" },
  { slug: "llm-responses", label: "LLM responses", table: "llm_responses", mode: "read", description: "Provider outputs and errors linked to each generation request, including HTTP status, duration, and token usage when reported.", fields: [], columns: ["id", "request_id", "generation_request_id", "provider", "model", "status", "http_status", "duration_ms", "llm_model_id", "prompt_chain_step_id", "usage", "error", "response", "created_at"], filter: "request_id" },
  { slug: "allowed-signup-domains", label: "Allowed signup domains", table: "allowed_signup_domains", mode: "crud", description: "Maintain the signup domain list. This catalog does not change the current Google superadmin login policy.", fields: [{ name: "domain", label: "Domain", type: "domain", required: true, max: 253 }], columns: ["id", "domain", "created_at"], search: "domain" },
  { slug: "whitelisted-emails", label: "Whitelisted e-mail addresses", table: "whitelisted_email_addresses", mode: "crud", description: "Maintain the e-mail whitelist. Entries do not grant administrator permission.", fields: [{ name: "email", label: "E-mail address", type: "email", required: true, max: 254 }], columns: ["id", "email", "created_at"], search: "email" },
];
const chain: ResourceRelation = { key: "chain", table: "prompt_chains", column: "prompt_chain_id", label: "Prompt chain", display: "name", resource: "prompt-chains", columns: ["id", "name", "workflow_key"] };
const model: ResourceRelation = { key: "model_record", table: "llm_models", column: "llm_model_id", label: "Model", display: "name", resource: "llm-models", columns: ["id", "name", "model_id"] };
const provider: ResourceRelation = { key: "provider_record", table: "llm_providers", column: "llm_provider_id", label: "Provider", display: "name", resource: "llm-providers", columns: ["id", "name"] };
const step: ResourceRelation = { key: "step", table: "prompt_chain_steps", column: "prompt_chain_step_id", label: "Prompt step", display: "name", resource: "prompt-chain-steps", columns: ["id", "name", "position"] };
const request: ResourceRelation = { key: "request_record", table: "generation_requests", column: "request_id", label: "Generation request", display: "source", resource: "generation-requests", columns: ["id", "source", "status", "user_id", "prompt_chain_id", "request", "prompt_snapshot", "mix_snapshot"] };
const status: ResourceFilter = { column: "status", label: "Status", kind: "enum", options: ["running", "succeeded", "failed", "cancelled", "historical"] };
const uuid = (column: string, label: string): ResourceFilter => ({ column, label, kind: "uuid" });
const reading: Record<string, Partial<AdminResource>> = {
  "prompt-chains": { readColumns: ["name", "workflow_key", "description", "created_at"] },
  "prompt-chain-steps": { readColumns: ["chain", "position", "name", "model_record", "created_at"], relations: [chain, model], filters: [uuid("llm_model_id", "Model ID")] },
  "prompt-chain-mix": { readColumns: ["chain", "weight", "enabled", "created_at"], relations: [chain] },
  "generation-requests": {
    readColumns: ["source", "status", "provider", "model", "chain", "attempt", "created_at"], relations: [chain, model, step],
    filters: [status, { column: "source", label: "Source", kind: "text" }, uuid("prompt_chain_id", "Prompt chain ID"), uuid("llm_model_id", "Model ID"), uuid("factory_batch_id", "Factory batch ID")],
    emptyMessage: "No generation requests have been recorded in this Supabase project yet.",
  },
  "llm-responses": {
    readColumns: ["request_record", "status", "model", "http_status", "duration_ms", "response", "created_at"], relations: [model, step, request],
    filters: [status, uuid("llm_model_id", "Model ID"), uuid("generation_request_id", "Legacy Factory batch ID")],
    emptyMessage: "No LLM responses have been recorded in this Supabase project yet.",
  },
  "llm-models": { readColumns: ["name", "model_id", "provider_record", "enabled", "created_at"], relations: [provider], filters: [uuid("llm_provider_id", "Provider ID")] },
  "llm-providers": { readColumns: ["name", "base_url", "enabled", "created_at"] },
  "ai-generation-examples": { readColumns: ["name", "chain", "created_at"], relations: [chain] },
};
export const adminResources: AdminResource[] = definitions.map(resource => ({ ...resource, ...reading[resource.slug] }));
export function resourceSelection(resource: AdminResource) {
  return [...resource.columns, ...(resource.relations ?? []).map(relation => `${relation.key}:${relation.table}!${relation.column}(${relation.columns.join(",")})`)].join(",");
}
export function resourceFilters(resource: AdminResource): ResourceFilter[] {
  const filters = [uuid("id", "Record ID"), ...(resource.filters ?? [])];
  if (resource.filter && !filters.some(filter => filter.column === resource.filter)) {
    filters.push(uuid(resource.filter, resource.filter === "user_id" ? "User ID" : resource.filter === "request_id" ? "Generation request ID" : "Prompt chain ID"));
  }
  return filters;
}
export function findAdminResource(slug: string) { return adminResources.find(resource => resource.slug === slug); }
export type ResourceRow = Record<string, unknown> & { id: string };
