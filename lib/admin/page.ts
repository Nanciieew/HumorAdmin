import "server-only";
import { notFound, redirect } from "next/navigation";
import { AdminError, requireAdmin } from "./auth";

export async function requireAdminPage(path: string) {
  try { return await requireAdmin(); }
  catch (error) {
    if (error instanceof AdminError && error.status === 401) redirect(`/login?next=${encodeURIComponent(path)}`);
    if (error instanceof AdminError && error.status === 403) notFound();
    throw error;
  }
}
