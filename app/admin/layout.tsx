import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin/page";
import { headers } from "next/headers";
import { adminReturnPath } from "@/lib/auth/return-path";
import styles from "./admin.module.css";

export const metadata: Metadata = { title: "Admin | checked", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage(adminReturnPath((await headers()).get("x-checked-admin-return")) ?? "/admin");
  return <main id="main" className={styles.admin}>
    <header className={styles.header}><div><p className={styles.eyebrow}>CHECKED / ADMINISTRATION</p><h1>Control room.</h1><p>Manage the media. Read the room.</p></div><span className={styles.badge}>SUPERADMIN</span></header>
    {children}
  </main>;
}
