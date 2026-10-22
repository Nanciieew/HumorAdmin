"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import type { AdminAccount, AdminMedia, AdminPage, AdminVote } from "@/lib/admin/types";
import styles from "./admin.module.css";

type Props = { section: "users" | "media" | "votes"; admin: { id: string; email: string }; params: string;
  data: AdminPage<AdminAccount> | AdminPage<AdminMedia> | AdminPage<AdminVote> };
const date = (value: string | null) => value ? new Date(value).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) : "—";
const accountName = (user: AdminAccount) => [user.first_name, user.last_name].filter(Boolean).join(" ") || "Awaiting profile";

export function AdminConsole({ section, admin, params, data }: Props) {
  const query = new URLSearchParams(params), router = useRouter();
  const [busy, setBusy] = useState(false), [pending, startTransition] = useTransition();
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<AdminMedia | null>(null);
  const [mode, setMode] = useState("upload"), [owner, setOwner] = useState(admin.id);
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [ownerQuery, setOwnerQuery] = useState(""), [owners, setOwners] = useState<AdminAccount[]>([]);
  const locked = busy || pending;
  const page = Number(query.get("page") ?? "1"), limit = Number(query.get("limit") ?? "25");
  const kind = query.get("kind") ?? "gallery";
  function pageLink(value: number) {
    const next = new URLSearchParams(params); next.set("page", String(value));
    return `/admin/${section}?${next}`;
  }
  async function run(url: string, options: RequestInit, success: string, refresh = true) {
    if (locked) return null;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(url, options);
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) router.push(`/login?next=${encodeURIComponent(`/admin/${section}`)}`);
        throw new Error(result.error || "The request failed.");
      }
      setNotice(success);
      if (refresh) startTransition(() => router.refresh());
      return result;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The request failed."); return null; }
    finally { setBusy(false); }
  }
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, values = new FormData(form);
    values.set("owner", owner);
    const result = mode === "upload"
      ? await run("/api/admin/media", { method: "POST", body: values }, "Image saved privately. Publish it when ready.")
      : await run("/api/admin/media/generate", json("POST", { owner, title: values.get("title"), description: values.get("description"), prompt: values.get("prompt") }), "Generated image saved privately. Publish it when ready.");
    if (result) { form.reset(); setFileName(""); }
  }

  return <>
    <div className={styles.sectionHeading}><h2>{section === "users" ? "Users & profiles" : section === "media" ? "Saved media" : "Votes & ratings"}</h2><span>{BigInt(data.total).toLocaleString("en-US")} records</span></div>
    <p className={styles.note}>{section === "users" ? "Account and profile information is read-only. Times are shown in New York time." : section === "votes" ? "Read-only gallery upvotes/downvotes and battle votes. Gallery totals appear in Media; there is no separate star-rating system." : "Edit captions, publish private images, or permanently delete saved media. Times are shown in New York time."}</p>

    <form key={`${section}:${params}`} action={`/admin/${section}`} className={styles.filters} aria-label="Filter records">
      {section !== "votes" && <label>Search<input name="search" defaultValue={query.get("search") ?? ""} maxLength={200} placeholder={section === "users" ? "Email, name or account ID" : "Title, description or media ID"} /></label>}
      {section === "media" && <>
        <label>Owner ID<input name="owner" defaultValue={query.get("owner") ?? ""} placeholder="Any owner" /></label>
        <label>Source<select name="source" defaultValue={query.get("source") ?? ""}><option value="">All sources</option><option value="generated">Generated</option><option value="upload">Upload</option></select></label>
        <label>Status<select name="status" defaultValue={query.get("status") ?? ""}><option value="">All statuses</option><option value="private">Private</option><option value="published">Published</option></select></label>
      </>}
      {section === "votes" && <>
        <label>Vote type<select name="kind" defaultValue={kind} onChange={event => { const form = event.currentTarget.form!; const value = form.elements.namedItem("value") as HTMLSelectElement | null; if (value) value.value = ""; form.requestSubmit(); }}><option value="gallery">Gallery</option><option value="battle">Battle</option></select></label>
        <label>{kind === "battle" ? "Challenge ID" : "Media ID"}<input name="target" defaultValue={query.get("target") ?? ""} placeholder="All targets" /></label>
        <label>Voter ID<input name="voter" defaultValue={query.get("voter") ?? ""} placeholder="All voters" /></label>
        {kind === "gallery" && <label>Value<select name="value" defaultValue={query.get("value") ?? ""}><option value="">All votes</option><option value="1">Upvote</option><option value="-1">Downvote</option></select></label>}
      </>}
      <button type="submit">Apply filters</button><Link href={`/admin/${section}`}>Clear</Link>
    </form>

    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {busy && <p role="status" className={styles.note}>{mode === "generate" ? "Working… Image generation can take a few minutes." : "Working…"}</p>}

    {section === "media" && <details className={styles.create}><summary>Create media</summary>
      <form onSubmit={create} aria-label="Create media">
        <fieldset disabled={locked}><legend>New private image</legend>
          <div className={styles.formGrid}>
            <label>Create with<select value={mode} onChange={event => { setMode(event.target.value); setFileName(""); }}><option value="upload">Upload finished image</option><option value="generate">Generate with AI</option></select></label>
            <label>Owner<select value={owner} onChange={event => setOwner(event.target.value)}><option value={admin.id}>{admin.email} (you)</option>{owners.filter(user => user.id !== admin.id).map(user => <option key={user.id} value={user.id}>{user.email} · {accountName(user)}</option>)}</select></label>
            <label>Find another owner<input value={ownerQuery} onChange={event => setOwnerQuery(event.target.value)} maxLength={200} placeholder="Search completed profiles by email or name" /></label>
            <button type="button" onClick={async () => {
              const result = await run(`/api/admin/users?completed=true&limit=100&search=${encodeURIComponent(ownerQuery)}`, {}, "Owner search complete.", false);
              if (result) { setOwners(result.items); setOwner(admin.id); setNotice(`${result.total} matching owners. Select one above${BigInt(result.total) > BigInt(100) ? "; narrow your search to find more" : ""}.`); }
            }}>Find owner</button>
            <label>Title<input name="title" maxLength={100} /></label>
            <label>Description<textarea name="description" maxLength={1000} rows={2} /></label>
          </div>
          {mode === "upload" ? <div>
            <label htmlFor="admin-media-file">Image (JPG, PNG or WebP, up to 2 MB)</label>
            <div className={styles.filePicker}>
              <input ref={fileInput} id="admin-media-file" className={styles.fileInput} type="file" name="file" accept="image/jpeg,image/png,image/webp" required aria-describedby="admin-media-file-status" onChange={event => setFileName(event.target.files?.[0]?.name ?? "")} />
              <button type="button" onClick={() => fileInput.current?.click()} aria-describedby="admin-media-file-status">Choose file</button>
              <span id="admin-media-file-status" role="status">{fileName || "No file chosen"}</span>
            </div>
          </div> : <label>Generation prompt<textarea key="prompt" name="prompt" required maxLength={4000} rows={3} placeholder="Describe the image to generate…" /></label>}
          <p className={styles.note}>{mode === "generate" ? "Uses the configured Seedream provider. The prompt is sent when you click Generate image." : "Upload an image you have already generated. It will be stored privately."}</p>
          <button className={styles.primary} type="submit">{mode === "upload" ? "Upload image" : "Generate image"}</button>
        </fieldset>
      </form>
    </details>}

    <div className={styles.tableWrap}><table className={styles.table}>
      <caption className={styles.srOnly}>{section === "users" ? "User accounts and profiles" : section === "media" ? "Saved media and vote totals" : "Individual votes"}</caption>
      <thead><tr>{(section === "users" ? ["Account", "Profile", "Status", "Created"] : section === "media" ? ["Preview", "Captions", "Owner & details", "Votes", "Actions"] : kind === "gallery" ? ["Media", "Voter", "Vote"] : ["Challenge", "Voter", "Voted for"]).map(heading => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
      <tbody>
        {section === "users" && (data.items as AdminAccount[]).map(user => <tr key={user.id}>
          <td><strong>{user.email ?? "No email"}</strong><code>{user.id}</code></td>
          <td>{accountName(user)}<small>{user.state_code ?? "No state selected"}</small></td>
          <td>{user.is_superadmin && <span className={styles.badge}>Admin</span>}<small>{user.onboarding_completed_at ? "Onboarding complete" : "Onboarding pending"}</small></td>
          <td>{date(user.account_created_at)}<small>Profile: {date(user.profile_created_at)}</small></td>
        </tr>)}
        {section === "media" && (data.items as AdminMedia[]).map(media => <tr key={media.id}>
          <td>{/* eslint-disable-next-line @next/next/no-img-element -- Authenticated previews must bypass the public image optimizer. */}
            <img className={styles.preview} src={`/api/admin/media/${media.id}/preview`} alt={media.title || "Saved media"} width={112} height={90} loading="lazy" /><code>{media.id}</code></td>
          <td><form key={`${media.id}:${media.title}:${media.description}`} onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget); await run(`/api/admin/media/${media.id}`, json("PATCH", { title: form.get("title"), description: form.get("description") }), "Captions saved."); }}>
            <label>Title<input name="title" maxLength={100} defaultValue={media.title} aria-label={`Title for ${media.id}`} disabled={locked} /></label>
            <label>Description<textarea name="description" maxLength={1000} defaultValue={media.description} rows={2} aria-label={`Description for ${media.id}`} disabled={locked} /></label>
            <button disabled={locked} type="submit">Save captions</button>
          </form></td>
          <td>{media.owner_name || "Unnamed owner"}<code>{media.contributor_id}</code><small>{media.source} · {media.published_at ? "Published" : "Private"}</small><small>Created: {date(media.created_at)}</small>{media.published_at && <small>Published: {date(media.published_at)}</small>}</td>
          <td><span>↑ {media.upvotes}</span><small>↓ {media.downvotes}</small></td>
          <td><div className={styles.rowActions}>{!media.published_at && <button disabled={locked} onClick={() => void run(`/api/admin/media/${media.id}/publish`, { method: "POST" }, "Image published to the gallery.")}>Publish</button>}<button className={styles.danger} disabled={locked} onClick={() => setDeleting(media)}>Delete</button></div></td>
        </tr>)}
        {section === "votes" && (data.items as AdminVote[]).map(vote => <tr key={`${vote.photo_id ?? vote.challenge_id}:${vote.voter_id}`}>
          <td>{vote.title || (kind === "battle" ? "Battle" : "Untitled image")}<code>{vote.photo_id ?? vote.challenge_id}</code></td>
          <td>{vote.voter_name || "Unnamed voter"}<code>{vote.voter_id}</code></td>
          <td>{kind === "gallery" ? vote.value === 1 ? "↑ Upvote" : "↓ Downvote" : <>{vote.target_name || "Unnamed participant"}<code>{vote.target_id}</code></>}</td>
        </tr>)}
        {data.items.length === 0 && <tr><td colSpan={section === "media" ? 5 : section === "users" ? 4 : 3}>No matching records.</td></tr>}
      </tbody>
    </table></div>
    <nav className={styles.pagination} aria-label="Record pages">{page > 1 ? <Link href={pageLink(page - 1)}>← Previous</Link> : <span /> }<span>Page {page}</span>{BigInt(page * limit) < BigInt(data.total) ? <Link href={pageLink(page + 1)}>Next →</Link> : <span />}</nav>

    {deleting && <div className={styles.modalBackdrop}><section role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description" className={styles.modal} onKeyDown={event => {
      if (event.key === "Escape" && !locked) setDeleting(null);
      if (event.key === "Tab") { const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")); if (!buttons.length) return; const first = buttons[0], last = buttons[buttons.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
    }}>
      <h2 id="delete-title">Delete this media?</h2><p id="delete-description">“{deleting.title || "Untitled image"}” and its gallery votes will be permanently deleted. This cannot be undone. Images referenced by sales cannot be deleted.</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.rowActions}><button autoFocus disabled={locked} onClick={() => { setDeleting(null); setError(""); }}>Cancel</button><button className={styles.danger} disabled={locked} onClick={async () => {
        const result = await run(`/api/admin/media/${deleting.id}`, json("DELETE", { confirmed: true }), "Media deleted."); if (result) setDeleting(null);
      }}>Permanently delete</button></div>
    </section></div>}
  </>;
}
