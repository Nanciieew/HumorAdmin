"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Icon } from "./ui";
import styles from "./sidebar.module.css";

const links = [
  { href: "/disguise", label: "Checked Factory", icon: "create" as const },
];

export function Sidebar({ children, isAdmin = false }: { children?: ReactNode; isAdmin?: boolean }) {
  const pathname = usePathname();
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const collapsed = !pinnedOpen && !hovered;
  return <aside id="sidebar-panel" className={`app-sidebar ${styles.sidebar}`} data-collapsed={collapsed}
    onPointerEnter={(event) => {
      if (event.pointerType === "mouse") setHovered(true);
    }}
    onPointerLeave={() => setHovered(false)}>
    <div className="sidebar-heading">
      <Link href="/" className="app-brand" aria-label="checked home" title={collapsed ? "checked" : undefined}><span className="sidebar-logo"><Image src="/brand/checked-face.png" alt="" width={32} height={32} className="sidebar-logo-face" /><Image src="/brand/checked-logo.png" alt="" width={128} height={32} className="sidebar-logo-full" /></span></Link>
      <button type="button" className="sidebar-toggle" aria-label={pinnedOpen ? "Unpin sidebar" : "Pin sidebar open"} title={pinnedOpen ? "Unpin sidebar" : "Pin sidebar open"} aria-expanded={!collapsed} aria-pressed={pinnedOpen} aria-controls="sidebar-panel" onClick={() => setPinnedOpen((value) => !value)}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /><path d={collapsed ? "m13 9 3 3-3 3" : "m16 9-3 3 3 3"} /></svg>
      </button>
    </div>
    <nav aria-label="Main navigation" className="sidebar-links">{[...(isAdmin ? [{ href: "/admin", label: "Control room", icon: "grid" as const }] : []), ...links].map((link) => {
      const active = link.href === "/" ? (pathname === "/" || pathname === "/quest") : pathname === link.href || pathname.startsWith(`${link.href}/`) || (link.href === "/my-works" && pathname.startsWith("/quest"));
      return <Link key={link.href} href={link.href} aria-label={link.label} title={collapsed ? link.label : undefined} aria-current={active ? "page" : undefined} className={active ? "active" : ""}><Icon name={link.icon} /><span>{link.label}</span><span className="nav-arrow" aria-hidden="true">↗</span></Link>;
    })}</nav>
    {children}
  </aside>;
}
