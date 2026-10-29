"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { AdminOverview } from "@/lib/admin/types";
import { Icon } from "../ui";
import styles from "./admin.module.css";

export function Overview({ data }: { data: AdminOverview }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const month = new Date(data.month_start).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", year: "numeric" });
  const updated = new Date(data.updated_at).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
  const metrics = [
    { label: "Total users", value: data.total_users, note: "All registered accounts", icon: "people" as const },
    { label: "New users this month", value: data.new_users_this_month, note: `Signed up in ${month}`, icon: "quest" as const },
    { label: "Total memes", value: data.total_memes, note: "Saved memes, including private drafts", icon: "works" as const },
    { label: "Total egos", value: data.total_egos, note: "Published ego uploads", icon: "flame" as const },
  ];
  return <section aria-labelledby="overview-title">
    <div className={styles.sectionHeading}><div><h2 id="overview-title">Overview</h2><p className={styles.note}>Your community, at a glance.</p></div>
      <button disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "Refreshing…" : "Refresh totals"}</button>
    </div>
    <div className={styles.overviewGrid}>{metrics.map(metric => <article key={metric.label} className={styles.overviewCard} aria-label={metric.label}>
      <div className={styles.overviewCardHeading}><h3>{metric.label}</h3><Icon name={metric.icon} /></div>
      <p className={styles.overviewValue}>{BigInt(metric.value).toLocaleString("en-US")}</p><p className={styles.overviewNote}>{metric.note}</p>
    </article>)}</div>
    <p className={styles.note}>Updated {updated}. Monthly totals use New York time.</p>
  </section>;
}
