import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { AppHeader } from "./app-header";
import { Sidebar } from "./sidebar";
import { getAuthViewer } from "@/lib/auth/profile";
import { profilePhotoUrl } from "@/lib/profile-photo";
import { AccountMenu } from "./account-menu";
import { Onboarding } from "./onboarding";
import { Suspense, type ReactNode } from "react";
import { PageLoading } from "./loading-indicator";
import "./globals.css";
import "./ego.css";

const inter = localFont({ src: "./fonts/inter.ttf", variable: "--font-inter", weight: "100 900", display: "swap" });
const anton = localFont({ src: "./fonts/anton.ttf", variable: "--font-anton", weight: "400", display: "swap" });

export const metadata: Metadata = {
  title: "Control room | checked",
  description: "Checked administration and image factory.",
  robots: { index: false, follow: false },
};

async function ViewerAccount({ name, initials, path, isAdmin }: { name: string; initials: string; path: string | null; isAdmin: boolean }) {
  return <AccountMenu signedIn name={name} initials={initials} photoUrl={await profilePhotoUrl(path)} isAdmin={isAdmin} />;
}

async function AppShell({ children }: { children: ReactNode }) {
  const session = await getAuthViewer();
  const profile = session?.profile;
  const viewer = profile?.onboarding_completed_at ? session : null;
  const isAdmin = profile?.is_superadmin === true && !!session?.user.email_confirmed_at && !!session.user.identities?.some(identity => identity.provider === "google");
  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");
  const initials = `${profile?.first_name?.slice(0, 1) ?? ""}${profile?.last_name?.slice(0, 1) ?? ""}`;
  return (
    <>
        <a href="#main" className="skip-link">Skip to content</a>
        <div className={viewer ? "app-shell" : "app-shell guest-shell"}>
          {viewer && <Sidebar isAdmin={isAdmin}><Suspense fallback={<AccountMenu signedIn name={name} initials={initials} photoUrl={null} isAdmin={isAdmin} />}><ViewerAccount name={name} initials={initials} path={profile?.avatar_path ?? null} isAdmin={isAdmin} /></Suspense></Sidebar>}
          <div className="site-content">
            <AppHeader>{!viewer ? <AccountMenu signedIn={false} name="" initials="" photoUrl={null} /> : undefined}</AppHeader>
            {!viewer && <nav className="ego-guest-nav" aria-label="Public navigation"><Link href="/admin">Control room</Link><Link href="/disguise">Checked Factory</Link></nav>}
            {children}
            <footer className="app-footer"><Link href="/">checked <span>© 2026</span></Link><Link href={viewer ? "/profile" : "/login"}>{viewer ? "Profile" : "Sign in"}</Link></footer>
          </div>
        </div>
        {session && !viewer && <Onboarding firstName={profile?.first_name ?? ""} lastName={profile?.last_name ?? ""} stateCode={profile?.state_code ?? ""} />}
    </>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en" className={`${inter.variable} ${anton.variable} h-full antialiased`}>
    <body className="min-h-full"><Suspense fallback={<PageLoading />}><AppShell>{children}</AppShell></Suspense></body>
  </html>;
}
