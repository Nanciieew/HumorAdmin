import { adminEndpoint, adminJson } from "@/lib/admin/http";
import { listAdminVotes } from "@/lib/admin/server";

export async function GET(request: Request) {
  return adminEndpoint(request, async () => adminJson(await listAdminVotes(new URL(request.url).searchParams)));
}
