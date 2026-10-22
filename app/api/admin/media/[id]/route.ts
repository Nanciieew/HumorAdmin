import { adminBody, adminEndpoint, adminJson, refreshAdminMedia } from "@/lib/admin/http";
import { deleteAdminMedia, updateAdminMedia } from "@/lib/admin/server";

type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, { params }: Context) {
  return adminEndpoint(request, async () => {
    const { id } = await params;
    const result = await updateAdminMedia(id, await adminBody(request));
    refreshAdminMedia(id);
    return adminJson(result);
  });
}
export async function DELETE(request: Request, { params }: Context) {
  return adminEndpoint(request, async () => {
    const { id } = await params;
    const result = await deleteAdminMedia(id, await adminBody(request));
    refreshAdminMedia(id);
    return adminJson(result);
  });
}
