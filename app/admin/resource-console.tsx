"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { AdminResource, ResourceRow } from "@/lib/admin/resources";
import type { AdminPage } from "@/lib/admin/types";
import styles from "./admin.module.css";

const label = (name: string) => name.replaceAll("_", " ").replace(/^./, first => first.toUpperCase());
function display(value: unknown) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
export function ResourceConsole({ resource, params, data }: { resource: AdminResource; params: string; data: AdminPage<ResourceRow> }) {
  const router = useRouter(), query = new URLSearchParams(params);
  const [editor, setEditor] = useState<ResourceRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<ResourceRow | null>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false), [pending, startTransition] = useTransition();
  const inFlight = useRef(false), locked = busy || pending;
  const page = Number(query.get("page") ?? 1), limit = Number(query.get("limit") ?? 25);
  const columns = resource.columns.filter(name => !["id", "response", "variants", "system_prompt", "user_prompt", "prompt", "output", "request", "prompt_snapshot", "mix_snapshot", "usage", "error"].includes(name));
  const endpoint = `/api/admin/resources/${resource.slug}`;
  async function mutate(method: string, body: unknown, id?: string) {
    if (inFlight.current || pending) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`${endpoint}${id ? `/${id}` : ""}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) router.push(`/login?next=${encodeURIComponent(`/admin/${resource.slug}`)}`);
        throw new Error(result.error || "The request failed.");
      }
      setEditor(null); setDeleting(null); setNotice(method === "DELETE" ? "Record deleted." : "Record saved.");
      startTransition(() => router.refresh());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The request failed."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function pageLink(value: number) { const next = new URLSearchParams(params); next.set("page", String(value)); return `/admin/${resource.slug}?${next}`; }
  return <>
    <div className={styles.sectionHeading}><h2>{resource.label}</h2><span>{BigInt(data.total).toLocaleString("en-US")} records</span></div>
    <p className={styles.note}>{resource.description}</p>
    {resource.mode === "crud" && <button disabled={locked} onClick={() => { setEditor("new"); setDeleting(null); setError(""); }}>Create record</button>}
    <form action={`/admin/${resource.slug}`} className={styles.filters} aria-label="Filter records">
      {resource.search && <label>Search<input name="search" defaultValue={query.get("search") ?? ""} maxLength={200} placeholder={`Search ${label(resource.search).toLowerCase()}`} /></label>}
      {resource.filter && <label>{label(resource.filter)}<input name={resource.filter} defaultValue={query.get(resource.filter) ?? ""} placeholder="Any ID" /></label>}
      {(resource.search || resource.filter) && <><button type="submit">Apply filters</button><Link href={`/admin/${resource.slug}`}>Clear</Link></>}
    </form>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {editor && <section className={styles.editor} aria-labelledby="record-editor-title">
      <h3 id="record-editor-title">{editor === "new" ? "Create record" : "Edit record"}</h3>
      <form key={editor === "new" ? "new" : editor.id} onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget), body: Record<string, unknown> = {};
        for (const field of resource.fields) {
          const value = String(form.get(field.name) ?? "");
          body[field.name] = field.type === "boolean" ? value === "true" : field.type === "number" && value !== "" ? Number(value) : value;
        }
        void mutate(editor === "new" ? "POST" : "PATCH", body, editor === "new" ? undefined : editor.id);
      }}>
        <fieldset disabled={locked} className={styles.fields}>
          {resource.fields.map(field => <label key={field.name}>{field.label}
            {field.type === "boolean" ? <select name={field.name} defaultValue={String(editor === "new" ? true : editor[field.name])}><option value="true">Enabled</option><option value="false">Disabled</option></select> : field.type === "longtext" ?
              <textarea name={field.name} rows={5} required={field.required} maxLength={field.max} defaultValue={editor === "new" ? "" : display(editor[field.name] ?? "")} /> :
              <input name={field.name} type={field.type === "number" ? "number" : field.type === "email" ? "email" : field.type === "url" ? "url" : "text"} step={field.type === "number" ? "any" : undefined} min={field.min} max={field.type === "number" ? field.max ?? 1000000 : undefined} maxLength={field.type !== "number" ? field.max : undefined} required={field.required} defaultValue={editor === "new" ? "" : display(editor[field.name] ?? "")} />}
          </label>)}
          <div className={styles.rowActions}><button type="submit">{busy ? "Saving…" : "Save record"}</button><button type="button" onClick={() => setEditor(null)}>Cancel</button></div>
        </fieldset>
      </form>
    </section>}
    {deleting && <section className={styles.editor} aria-labelledby="delete-record-title">
      <h3 id="delete-record-title">Delete this record?</h3><p>This permanently removes record {deleting.id}. Linked records may prevent deletion.</p>
      <div className={styles.rowActions}><button autoFocus disabled={locked} onClick={() => setDeleting(null)}>Cancel</button><button className={styles.danger} disabled={locked} onClick={() => void mutate("DELETE", { confirmed: true }, deleting.id)}>Permanently delete</button></div>
    </section>}
    <div className={styles.tableWrap}><table className={styles.table}><caption className={styles.srOnly}>{resource.label}</caption>
      <thead><tr>{columns.map(name => <th key={name} scope="col">{label(name)}</th>)}<th scope="col">Details & actions</th></tr></thead>
      <tbody>{data.items.map(row => <tr key={row.id}>
        {columns.map(name => <td key={name}><span className={styles.cellValue}>{display(row[name])}</span></td>)}
        <td><div className={styles.rowActions}>
          {resource.mode !== "read" && <button disabled={locked} onClick={() => { setEditor(row); setDeleting(null); setError(""); }}>Edit</button>}
          {resource.mode === "crud" && <button className={styles.danger} disabled={locked} onClick={() => { setDeleting(row); setEditor(null); setError(""); }}>Delete</button>}
          {resource.slug === "prompt-chains" && <><Link href={`/admin/prompt-chain-steps?prompt_chain_id=${row.id}`}>Steps</Link><Link href={`/admin/prompt-chain-mix?prompt_chain_id=${row.id}`}>Mix</Link></>}
          {resource.slug === "generation-requests" && <Link href={`/admin/llm-responses?request_id=${row.id}`}>LLM responses</Link>}
        </div><details className={styles.details}><summary>View full record</summary><dl>{resource.columns.map(name => <div key={name}><dt>{label(name)}</dt><dd><pre>{display(row[name])}</pre></dd></div>)}</dl></details></td>
      </tr>)}{!data.items.length && <tr><td colSpan={columns.length + 1}>No matching records.</td></tr>}</tbody>
    </table></div>
    <nav className={styles.pagination} aria-label="Record pages">{page > 1 ? <Link href={pageLink(page - 1)}>← Previous</Link> : <span />}<span>Page {page}</span>{BigInt(page * limit) < BigInt(data.total) ? <Link href={pageLink(page + 1)}>Next →</Link> : <span />}</nav>
  </>;
}
