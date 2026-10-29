import Link from "next/link";
import type { AdminResource, ResourceRow } from "@/lib/admin/resources";
import { date, display, label, providerOutput, record, requestPrompts } from "@/lib/admin/resource-display";
import styles from "./admin.module.css";

export function ResourceCell({ resource, row, name }: { resource: AdminResource; row: ResourceRow; name: string }) {
  const relation = resource.relations?.find(relation => relation.key === name);
  if (relation) {
    const related = record(row[name]);
    const id = related.id ?? row[relation.column];
    return typeof id === "string" ? <Link href={`/admin/${relation.resource}?id=${encodeURIComponent(id)}`}>{display(related[relation.display] ?? id)}</Link> : <>—</>;
  }
  const value = row[name];
  if (name.endsWith("_at") && typeof value === "string") return <time dateTime={value}>{date(value)}</time>;
  if (name === "duration_ms" && typeof value === "number") return <>{value.toLocaleString("en-US")} ms</>;
  if (name === "status" && typeof value === "string") return <span className={styles.recordStatus} data-status={value}>{label(value)}</span>;
  return <span className={styles.cellValue}>{name === "response" ? providerOutput(value).slice(0, 240) : display(value)}</span>;
}

function RecordedInput({ value }: { value: unknown }) {
  const prompts = requestPrompts(value);
  return <section className={styles.recordSection} aria-label="Recorded input">
    <h4>Recorded input</h4>
    {prompts.system && <><h5>System prompt sent</h5><pre>{prompts.system}</pre></>}
    {prompts.user && <><h5>User prompt sent</h5><pre>{prompts.user}</pre></>}
    {prompts.settings !== undefined && <><h5>Generation settings</h5><pre>{display(prompts.settings)}</pre></>}
    {value == null && <p>The original input was not retained for this historical call.</p>}
    {value != null && !prompts.system && !prompts.user && <pre>{display(value)}</pre>}
  </section>;
}

export function ResourceRecord({ resource, row }: { resource: AdminResource; row: ResourceRow }) {
  const request = resource.slug === "generation-requests" ? row : resource.slug === "llm-responses" ? record(row.request_record) : null;
  return <details className={styles.details}><summary>View full record</summary>
    {request && Object.keys(request).length > 0 && <>
      <RecordedInput value={request.request} />
      <section className={styles.recordSection} aria-label="Recorded prompt and mix"><h4>Prompt and mix at generation time</h4>
        <p>These are the values saved with this call.</p>
        <h5>Prompt step snapshot</h5><pre>{display(request.prompt_snapshot)}</pre>
        <h5>Mix snapshot</h5><pre>{display(request.mix_snapshot)}</pre>
      </section>
    </>}
    {resource.slug === "llm-responses" && <section className={styles.recordSection} aria-label="Provider result"><h4>Provider result</h4>
      <pre>{providerOutput(row.response)}</pre><h5>Reported usage</h5><pre>{row.usage == null ? "Usage was not reported for this call." : display(row.usage)}</pre>
      {row.error != null && <><h5>Recorded error</h5><pre>{display(row.error)}</pre></>}
    </section>}
    {resource.slug === "prompt-chain-steps" && <section className={styles.recordSection} aria-label="Step prompts"><h4>Step prompts</h4>
      <h5>System prompt</h5><pre>{display(row.system_prompt)}</pre><h5>User prompt template</h5><pre>{display(row.user_prompt)}</pre>
    </section>}
    <dl>{resource.columns.map(name => <div key={name}><dt>{label(name)}</dt><dd><pre>{name.endsWith("_at") ? date(row[name]) : display(row[name])}</pre></dd></div>)}</dl>
  </details>;
}
