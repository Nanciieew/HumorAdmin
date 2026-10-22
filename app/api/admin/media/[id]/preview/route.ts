import { adminEndpoint, adminHeaders } from "@/lib/admin/http";
import { previewAdminMedia } from "@/lib/admin/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return adminEndpoint(request, async () => {
    const file = await previewAdminMedia((await params).id);
    return new Response(file, { headers: { ...adminHeaders, "Content-Type": "image/webp", "Content-Disposition": "inline" } });
  });
}
