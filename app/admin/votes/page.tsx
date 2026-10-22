import { requireAdminPage } from "@/lib/admin/page";
import { listAdminVotes } from "@/lib/admin/server";
import { AdminConsole } from "../console";
import { adminSearchParams } from "../search-params";

export default async function VotesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = adminSearchParams(await searchParams);
  const admin = await requireAdminPage(`/admin/votes${params.size ? `?${params}` : ""}`);
  return <AdminConsole section="votes" admin={admin} params={params.toString()} data={await listAdminVotes(params)} />;
}
