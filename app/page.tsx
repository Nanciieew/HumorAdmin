import { redirect } from "next/navigation";
import { getAuthViewer } from "@/lib/auth/profile";

export default async function HomePage() {
  const viewer = await getAuthViewer();
  if (!viewer) redirect("/login?next=/admin");
  if (!viewer.profile?.onboarding_completed_at) {
    return <main id="main" className="login-page"><p>Complete your profile to continue.</p></main>;
  }
  const admin = viewer.profile.is_superadmin === true && !!viewer.user.email_confirmed_at &&
    viewer.user.identities?.some(identity => identity.provider === "google");
  redirect(admin ? "/admin" : "/disguise");
}
