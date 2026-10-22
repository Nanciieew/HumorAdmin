import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { AdminError, verifyAdmin } from "@/lib/admin/auth";

export async function clearAdminSession(auth: SupabaseClient) {
  // Local scope preserves the user's sessions on the original application.
  try { await auth.auth.signOut({ scope: "local" }); } catch { /* Cookie cleanup below still denies this browser session. */ }
  const jar = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (url) {
    const prefix = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
    for (const { name } of jar.getAll()) {
      if (name === prefix || name.startsWith(`${prefix}.`) || name === `${prefix}-code-verifier` || name.startsWith(`${prefix}-code-verifier.`)) jar.delete(name);
    }
  }
  jar.delete("ego_return");
}

export async function completeAdminLogin(auth: SupabaseClient) {
  try {
    return { admin: await verifyAdmin(auth), error: null };
  } catch (error) {
    await clearAdminSession(auth);
    return { admin: null, error: error instanceof AdminError && error.status === 403 ? "access_denied" :
      error instanceof AdminError && error.status === 401 ? "oauth" : "verification" };
  }
}
