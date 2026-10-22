import { requireAdminPage } from "@/lib/admin/page";
import { listAdminUsers } from "@/lib/admin/server";
import { AdminConsole } from "../console";
import { adminSearchParams } from "../search-params";

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = adminSearchParams(await searchParams);
  const admin = await requireAdminPage(`/admin/users${params.size ? `?${params}` : ""}`);
  return <AdminConsole section="users" admin={admin} params={params.toString()} data={await listAdminUsers(params)} />;
}
