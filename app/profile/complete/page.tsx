import { redirect } from "next/navigation";
import { getAuthViewer } from "@/lib/auth/profile";

export default async function CompleteProfilePage() {
  const viewer = await getAuthViewer();
  redirect(viewer ? "/" : "/login");
}
