import { returnPath } from "@/lib/auth/return-path";
import { PlayfulTitle } from "../playful-title";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthViewer } from "@/lib/auth/profile";
import { GoogleLoginForm } from "./google-login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  const viewer = await getAuthViewer();
  if (viewer && !error) redirect(returnPath(next));
  return (
    <main id="main" className="login-page">
      <Link href="/" className="text-sm opacity-70 hover:underline">← Back to checked</Link>
      <section className="login-panel">
        <p className="eyebrow">checked</p>
        <PlayfulTitle text="Accountability starts here." />
        <p className="mt-3 leading-relaxed opacity-70">Log in or join with your Google account. No new password to remember.</p>
        {error && <p role="alert" className="mt-5 text-sm text-red-600 dark:text-red-400">{error === "logout" ? "We couldn’t log you out. Please try again." : "Google sign-in wasn’t completed. Please try again."}</p>}
        <GoogleLoginForm next={returnPath(next)} />
      </section>
    </main>
  );
}
