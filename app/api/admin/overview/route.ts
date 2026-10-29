import { adminEndpoint, adminJson } from "@/lib/admin/http";
import { readAdminOverview } from "@/lib/admin/overview";

export async function GET(request: Request) {
  return adminEndpoint(request, async () => adminJson(await readAdminOverview()));
}
