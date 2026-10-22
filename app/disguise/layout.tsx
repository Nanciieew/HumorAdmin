import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { getViewer } from "@/lib/auth/profile";
import { DisguiseStudio } from "./studio";
import { PageLoading } from "../loading-indicator";
import { requireAdminPage } from "@/lib/admin/page";

async function FactorySession({ children }: { children: ReactNode }) {
  await requireAdminPage("/disguise");
  const viewer = await getViewer();
  if (!viewer) redirect("/profile/complete");
  const galleryUrl = process.env.USER_SITE_URL ? new URL("/gallery", process.env.USER_SITE_URL).href : undefined;
  return <>{children}<DisguiseStudio galleryUrl={galleryUrl} userId={viewer.user.id} configured={Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL)} /></>;
}

export default function FactoryLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoading />}><FactorySession>{children}</FactorySession></Suspense>;
}
