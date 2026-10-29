import { revalidatePath } from "next/cache";
import { adminBody, adminEndpoint, adminJson } from "@/lib/admin/http";
import { listResource, writeResource } from "@/lib/admin/resource-server";
type Context = { params: Promise<{ resource: string }> };
export async function GET(request: Request, { params }: Context) {
  return adminEndpoint(request, async () => adminJson(await listResource((await params).resource, new URL(request.url).searchParams)));
}
export async function POST(request: Request, { params }: Context) {
  return adminEndpoint(request, async () => {
    const { resource } = await params;
    const result = await writeResource(resource, await adminBody(request));
    revalidatePath(`/admin/${resource}`);
    return adminJson(result, 201);
  });
}
