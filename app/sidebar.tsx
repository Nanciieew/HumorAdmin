"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Icon } from "./ui";
import styles from "./sidebar.module.css";
import { adminResources } from "@/lib/admin/resources";

type SidebarLink = { href: string; label: string };
type SidebarGroup = { id: string; label: string; icon: ComponentProps<typeof Icon>["name"]; links: SidebarLink[] };

function resourceLinks(slugs: string[]): SidebarLink[] {
  return adminResources.filter(resource => slugs.includes(resource.slug))
    .map(resource => ({ href: `/admin/${resource.slug}`, label: resource.label }));
}

const links = [
  { href: "/disguise", label: "Checked Factory", icon: "create" as const },
];

const adminGroups: SidebarGroup[] = [
  {
    id: "users", label: "Users and Profiles", icon: "people",
    links: [
      { href: "/admin/users", label: "Users and Profiles" },
      ...resourceLinks(["allowed-signup-domains", "whitelisted-emails"]),
    ],
  },
  {
    id: "images", label: "Images", icon: "works",
    links: [
      { href: "/admin/images", label: "Images" },
      { href: "/admin/media", label: "AI generated media" },
    ],
  },
  {
    id: "prompts", label: "Prompts", icon: "quest",
    links: resourceLinks(["prompt-chains", "prompt-chain-steps", "prompt-chain-mix", "terms"]),
  },
  {
    id: "generation", label: "Generation and LLM", icon: "spark",
    links: resourceLinks(["generation-requests", "ai-generation-examples", "llm-models", "llm-providers", "llm-responses"]),
  },
];

function isActiveLink(pathname: string, href: string) {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavigationGroup({ group, pathname, collapsed, expandSidebar }: {
  group: SidebarGroup; pathname: string; collapsed: boolean; expandSidebar: () => void;
}) {
  const active = group.links.some(link => isActiveLink(pathname, link.href));
  const [open, setOpen] = useState(active);
  const expanded = open && !collapsed;
  const panelId = `sidebar-group-${group.id}`;

  return <div className={styles.group}>
    <button type="button" className={styles.groupToggle} data-active={active}
      aria-label={group.label} title={collapsed ? group.label : undefined}
      aria-expanded={expanded} aria-controls={panelId}
      onClick={() => {
        if (collapsed) {
          expandSidebar();
          setOpen(true);
        } else {
          setOpen(value => !value);
        }
      }}>
      <Icon name={group.icon} /><span className={styles.groupLabel}>{group.label}</span>
      <svg className={styles.chevron} data-expanded={expanded} aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 5 7 7-7 7" /></svg>
    </button>
    <ul id={panelId} className={styles.subLinks} aria-label={group.label} hidden={!expanded}>
      {group.links.map(link => {
        const current = isActiveLink(pathname, link.href);
        return <li key={link.href}><Link href={link.href} aria-current={current ? "page" : undefined} className={current ? "active" : ""}>{link.label}</Link></li>;
      })}
    </ul>
  </div>;
}

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
    <nav aria-label="Main navigation" className="sidebar-links">{isAdmin && <Link href="/admin" aria-label="Overview" title={collapsed ? "Overview" : undefined} aria-current={isActiveLink(pathname, "/admin") ? "page" : undefined} className={isActiveLink(pathname, "/admin") ? "active" : ""}><Icon name="grid" /><span>Overview</span></Link>}{isAdmin && adminGroups.map(group =>
      <NavigationGroup key={`${group.id}:${pathname}`} group={group} pathname={pathname} collapsed={collapsed} expandSidebar={() => setPinnedOpen(true)} />
    )}{links.map((link) => {
      const active = isActiveLink(pathname, link.href);
      return <Link key={link.href} href={link.href} aria-label={link.label} title={collapsed ? link.label : undefined} aria-current={active ? "page" : undefined} className={active ? "active" : ""}><Icon name={link.icon} /><span>{link.label}</span></Link>;
    })}</nav>
    {children}
  </aside>;
}
