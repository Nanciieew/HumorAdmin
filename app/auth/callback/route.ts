import { cookies } from "next/headers";
import { readProfile } from "@/lib/auth/profile";
import { redirect } from "next/navigation";
import { createAuthClient } from "@/lib/auth/server";
import { returnPath } from "@/lib/auth/return-path";
import { clearAdminSession, completeAdminLogin } from "@/lib/auth/admin-login";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const auth = await createAuthClient();
  const jar = await cookies();
  const destination = returnPath(jar.get("ego_return")?.value);
  if (!params.has("error") && code) {
    const { error } = await auth.auth.exchangeCodeForSession(code);
    if (!error) {
      const result = await completeAdminLogin(auth);
      if (!result.admin) redirect(`/login?${new URLSearchParams({ error: result.error!, next: destination })}`);
      const profile = await readProfile(result.admin.id);
      if (profile?.onboarding_completed_at) {
        jar.delete("ego_return");
        redirect(destination);
      }
      redirect("/profile/complete");
    }
  }
  await clearAdminSession(auth);
  redirect("/login?error=oauth");
}
