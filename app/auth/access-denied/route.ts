import { redirect } from "next/navigation";
import { createAuthClient } from "@/lib/auth/server";
import { completeAdminLogin } from "@/lib/auth/admin-login";
import { returnPath } from "@/lib/auth/return-path";

// Recheck permission before signing out: a link to this route cannot log out an
// authorized administrator. Stale/revoked sessions are cleared on this origin.
export async function GET(request: Request) {
  const destination = returnPath(new URL(request.url).searchParams.get("next"));
  const result = await completeAdminLogin(await createAuthClient());
  if (result.admin) redirect(destination);
  redirect(`/login?${new URLSearchParams({ error: result.error!, next: destination })}`);
}
