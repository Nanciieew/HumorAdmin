import { adminEndpoint, adminJson, adminUploadBody, refreshAdminMedia } from "@/lib/admin/http";
import { listAdminMedia, uploadAdminMedia } from "@/lib/admin/server";

export async function GET(request: Request) {
  return adminEndpoint(request, async () => adminJson(await listAdminMedia(new URL(request.url).searchParams)));
}
export async function POST(request: Request) {
  return adminEndpoint(request, async () => {
    const result = await uploadAdminMedia(await adminUploadBody(request));
    refreshAdminMedia(result.id);
    return adminJson(result, 201);
  });
}
