"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { logout } from "./auth/actions";
import { Icon } from "./ui";

export function AccountMenu({ signedIn, name, initials, photoUrl, isAdmin = false }: { signedIn: boolean; name: string; initials: string; photoUrl: string | null; isAdmin?: boolean }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  if (!signedIn) return <nav aria-label="Account"><Link href="/login" className="guest-login">Log in <Icon name="arrow" /></Link></nav>;
  return <nav aria-label="Account" className="sidebar-account">
    <details ref={menu} onToggle={(event) => setOpen(event.currentTarget.open)} onKeyDown={(event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const details = menu.current;
      if (!details) return;
      const wasOpen = details.open;
      details.open = true;
      const items = Array.from(details.querySelectorAll<HTMLElement>("a, button"));
      const index = items.indexOf(document.activeElement as HTMLElement);
      items[wasOpen && index >= 0 ? (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length : 0]?.focus();
    }}>
      <summary aria-label="Open account options" aria-expanded={open} title={name || "Your account"} className="account-trigger">
        <span className="account-face">{photoUrl ? <Image src={photoUrl} alt="Your profile photo" width={48} height={48} unoptimized /> : <span>{initials || ":)"}</span>}</span>
        <span className="account-text"><strong>{name || "Your account"}</strong><small>Personal account</small></span><span aria-hidden="true" className="account-dots">···</span>
      </summary>
      <div className="account-popup">
        {isAdmin && <Link href="/admin" onClick={() => { if (menu.current) menu.current.open = false; }}><Icon name="grid" />Admin</Link>}
        <Link href="/profile" onClick={() => { if (menu.current) menu.current.open = false; }}><Icon name="user" />Profile</Link>
        <div className="menu-divider" />
        <form action={logout}><button><Icon name="logout" />Log out</button></form>
      </div>
    </details>
  </nav>;
}
