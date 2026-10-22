import { adminBody, adminEndpoint, adminJson, refreshAdminMedia } from "@/lib/admin/http";
import { generateAdminMedia } from "@/lib/admin/server";

export const maxDuration = 180;
export async function POST(request: Request) {
  return adminEndpoint(request, async () => {
    const result = await generateAdminMedia(await adminBody(request), request.signal);
    refreshAdminMedia(result.id);
    return adminJson(result, 201);
  });
}
