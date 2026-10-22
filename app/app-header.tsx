"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ColorPlay } from "./ui";

export function AppHeader({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
  const title = pathname.startsWith("/admin") ? "CONTROL ROOM" : pathname === "/" || pathname === "/quest" ? "CHECKLY QUEST" : pathname.startsWith("/you-are-a-joke") ? "GET CHECKED" : pathname.startsWith("/disguise") ? "CHECKED FACTORY" : pathname.startsWith("/gallery") || pathname.startsWith("/avatars") ? "CHECKED GALLERY" : pathname.startsWith("/my-works") ? "MY CHECKBOARD" : pathname.startsWith("/profile") ? "THE USUAL SUSPECT" : "checked";
  return <header className="app-topbar"><span className="topbar-title"><ColorPlay />{title}</span>{children}</header>;
}
