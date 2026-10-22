import { adminEndpoint, adminJson } from "@/lib/admin/http";
import { loadRecaptionSource } from "@/lib/admin/recaption";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return adminEndpoint(request, async () => adminJson(await loadRecaptionSource((await params).id)));
}
