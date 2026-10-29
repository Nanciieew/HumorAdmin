import { revalidatePath } from "next/cache";
import { adminBody, adminEndpoint, adminJson } from "@/lib/admin/http";
import { readResource, writeResource, deleteResource } from "@/lib/admin/resource-server";
type Context = { params: Promise<{ resource: string; id: string }> };
export async function GET(request: Request, { params }: Context) {
  return adminEndpoint(request, async () => { const { resource, id } = await params; return adminJson(await readResource(resource, id)); });
}
export async function PATCH(request: Request, { params }: Context) {
  return adminEndpoint(request, async () => {
    const { resource, id } = await params;
    const result = await writeResource(resource, await adminBody(request), id);
    revalidatePath(`/admin/${resource}`);
    return adminJson(result);
  });
}
export async function DELETE(request: Request, { params }: Context) {
  return adminEndpoint(request, async () => {
    const { resource, id } = await params;
    const result = await deleteResource(resource, id, await adminBody(request));
    revalidatePath(`/admin/${resource}`);
    return adminJson(result);
  });
}
