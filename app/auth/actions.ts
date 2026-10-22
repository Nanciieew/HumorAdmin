"use server";

import { cookies } from "next/headers";
import { returnPath } from "@/lib/auth/return-path";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAuthClient } from "@/lib/auth/server";

export type FormState = { error?: string };

export async function loginWithGoogle(_state: FormState, form: FormData): Promise<FormState> {
  const next = returnPath(form.get("next"));
  (await cookies()).set("ego_return", next, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 3600 });
  const origin = (await headers()).get("origin");
  if (!origin) return { error: "Please refresh the page and try again." };
  const auth = await createAuthClient();
  const { data, error } = await auth.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: new URL("/auth/callback", origin).toString(), skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
  });
  if (error || !data.url) return { error: "Google login is unavailable. Please try again." };
  redirect(data.url);
}

export async function logout() {
  const auth = await createAuthClient();
  const { error } = await auth.auth.signOut({ scope: "local" });
  if (error) redirect("/login?error=logout");
  revalidatePath("/", "layout");
  redirect("/");
}
