import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/admin/page";

export default async function VotesPage() {
  await requireAdminPage("/admin/media");
  redirect("/admin/media");
}
