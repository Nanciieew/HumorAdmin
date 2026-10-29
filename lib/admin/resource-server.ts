import "server-only";
import { supabase } from "@/lib/supabase";
import { isUuid } from "@/lib/gallery-types";
import { AdminError, requireAdmin } from "./auth";
import { pagination } from "./server";
import { findAdminResource, type AdminResource, type ResourceRow } from "./resources";
import type { AdminPage } from "./types";

function resourceFor(slug: string) {
  const resource = findAdminResource(slug);
  if (!resource) throw new AdminError("Resource not found.", 404);
  return resource;
}
function databaseError(error: { code?: string }) {
  if (error.code === "23505") return new AdminError("A record with these values already exists.", 409);
  if (error.code === "23503") return new AdminError("A linked record is missing, or this record is still in use.", 409);
  if (["23514", "23502", "22P02"].includes(error.code ?? "")) return new AdminError("Check the field values and try again.");
  return new AdminError("Unable to access this catalog. Check that the admin catalog migration has been applied.", 503);
}
export function resourceValues(resource: AdminResource, body: unknown, creating: boolean) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AdminError("Enter a valid record.");
  const input = body as Record<string, unknown>, values: Record<string, unknown> = {};
  if (Object.keys(input).some(key => !resource.fields.some(field => field.name === key))) throw new AdminError("This record contains a field that cannot be edited.");
  for (const field of resource.fields) {
    if (!(field.name in input)) { if (creating && field.required) throw new AdminError(`${field.label} is required.`); continue; }
    let value = input[field.name];
    if (typeof value === "string") value = value.trim();
    if (value === "" || value === null) {
      if (field.required) throw new AdminError(`${field.label} is required.`);
      values[field.name] = null; continue;
    }
    if (field.type === "boolean") {
      if (typeof value !== "boolean") throw new AdminError(`${field.label} must be enabled or disabled.`);
    } else if (field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < (field.min ?? -Infinity) || value > (field.max ?? 1000000)) throw new AdminError(`Enter a valid ${field.label.toLowerCase()}.`);
    } else {
      if (typeof value !== "string" || !value || value.length > (field.max ?? 10000)) throw new AdminError(`Enter a valid ${field.label.toLowerCase()}.`);
      if (field.type === "uuid" && !isUuid(value)) throw new AdminError(`${field.label} must be a valid UUID.`);
      if (field.type === "domain") {
        value = String(value).toLowerCase();
        if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value as string)) throw new AdminError("Enter a domain such as columbia.edu, without @ or a URL.");
      }
      if (field.type === "email") {
        value = String(value).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value as string)) throw new AdminError("Enter a valid e-mail address.");
      }
      if (field.type === "url") {
        try { const url = new URL(value as string); if (url.protocol !== "https:" || url.username || url.password) throw new Error(); }
        catch { throw new AdminError("Enter an HTTPS URL without embedded credentials."); }
      }
    }
    values[field.name] = value;
  }
  if (!Object.keys(values).length) throw new AdminError("Enter at least one field to save.");
  return values;
}
export async function listResource(slug: string, params: URLSearchParams): Promise<AdminPage<ResourceRow>> {
  await requireAdmin();
  const resource = resourceFor(slug), { p_offset, p_limit } = pagination(params);
  const search = (params.get("search") ?? "").trim();
  if (search.length > 200) throw new AdminError("Use a search of up to 200 characters.");
  let query = supabase.from(resource.table).select(resource.columns.join(","), { count: "exact" });
  if (search && resource.search) query = query.ilike(resource.search, `%${search.replace(/[\\%_]/g, "\\$&")}%`);
  if (resource.filter && params.get(resource.filter)) {
    const value = params.get(resource.filter);
    if (!isUuid(value)) throw new AdminError("Enter a valid filter ID.");
    query = query.eq(resource.filter, value);
  }
  if (slug === "prompt-chain-steps") query = query.order("prompt_chain_id").order("position");
  else query = query.order("created_at", { ascending: false });
  const result = await query.order("id").range(p_offset, p_offset + p_limit - 1);
  if (result.error) throw databaseError(result.error);
  return { items: result.data as unknown as ResourceRow[], total: String(result.count ?? 0) };
}
export async function readResource(slug: string, id: string) {
  await requireAdmin();
  const resource = resourceFor(slug);
  if (!isUuid(id)) throw new AdminError("Record not found.", 404);
  const result = await supabase.from(resource.table).select(resource.columns.join(",")).eq("id", id).maybeSingle();
  if (result.error) throw databaseError(result.error);
  if (!result.data) throw new AdminError("Record not found.", 404);
  return result.data;
}
export async function writeResource(slug: string, body: unknown, id?: string) {
  await requireAdmin();
  const resource = resourceFor(slug);
  if (resource.mode === "read" || !id && resource.mode !== "crud") throw new AdminError("This operation is not allowed for this resource.", 405);
  if (id && !isUuid(id)) throw new AdminError("Record not found.", 404);
  const values = resourceValues(resource, body, !id);
  const table = supabase.from(resource.table);
  const result = await (id ? table.update(values).eq("id", id) : table.insert(values)).select(resource.columns.join(",")).maybeSingle();
  if (result.error) throw databaseError(result.error);
  if (!result.data) throw new AdminError("Record not found.", 404);
  return result.data;
}
export async function deleteResource(slug: string, id: string, body: unknown) {
  await requireAdmin();
  const resource = resourceFor(slug);
  if (resource.mode !== "crud") throw new AdminError("This resource cannot be deleted.", 405);
  if (!isUuid(id)) throw new AdminError("Record not found.", 404);
  if ((body as { confirmed?: unknown } | null)?.confirmed !== true) throw new AdminError("Confirm permanent deletion first.");
  const result = await supabase.from(resource.table).delete().eq("id", id);
  if (result.error) throw databaseError(result.error);
  return { deleted: true };
}
