import { adminEndpoint, adminJson } from "@/lib/admin/http";
import { listAdminUsers } from "@/lib/admin/server";

export async function GET(request: Request) {
  return adminEndpoint(request, async () => adminJson(await listAdminUsers(new URL(request.url).searchParams)));
}
