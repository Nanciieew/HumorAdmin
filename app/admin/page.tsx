import { requireAdminPage } from "@/lib/admin/page";
import { readAdminOverview } from "@/lib/admin/overview";
import { Overview } from "./overview";

export default async function AdminPage() {
  await requireAdminPage("/admin");
  return <Overview data={await readAdminOverview()} />;
}
