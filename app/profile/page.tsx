import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/profile";
import { profilePhotoUrl } from "@/lib/profile-photo";
import { ProfileEditor } from "./profile-editor";
import styles from "./profile.module.css";

export default async function ProfilePage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const profile = viewer.profile;
  const photoUrl = await profilePhotoUrl(profile?.avatar_path ?? null);
  return <main id="main" className={styles.page}><ProfileEditor stateCode={profile?.state_code ?? ""} firstName={profile?.first_name ?? ""} lastName={profile?.last_name ?? ""} photoUrl={photoUrl} /></main>;
}
