import { requireAdminPage } from "@/lib/admin/page";
import { listAdminMedia } from "@/lib/admin/server";
import { AdminConsole } from "../console";
import { adminSearchParams } from "../search-params";

export default async function ImagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = adminSearchParams(await searchParams);
  await requireAdminPage(`/admin/images${params.size ? `?${params}` : ""}`);
  return <AdminConsole section="images" params={params.toString()} data={await listAdminMedia(params)} />;
}
