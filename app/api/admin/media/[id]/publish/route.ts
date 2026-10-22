import { adminEndpoint, adminJson, refreshAdminMedia } from "@/lib/admin/http";
import { publishAdminMedia } from "@/lib/admin/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return adminEndpoint(request, async () => {
    const { id } = await params;
    const result = await publishAdminMedia(id);
    refreshAdminMedia(id);
    return adminJson(result);
  });
}
