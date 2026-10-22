import { redirect } from "next/navigation";
import { getAuthViewer } from "@/lib/auth/profile";
import { requireAdminPage } from "@/lib/admin/page";

export default async function CompleteProfilePage() {
  await requireAdminPage("/profile/complete");
  const viewer = await getAuthViewer();
  redirect(viewer ? "/" : "/login");
}
