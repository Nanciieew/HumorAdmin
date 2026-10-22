import type { ReactNode } from "react";

type IconName = "quest" | "create" | "roast" | "checkboard" | "home" | "flame" | "people" | "settings" | "marketplace" | "works" | "arrow" | "grid" | "spark" | "mask" | "user" | "leaderboard" | "logout" | "upload" | "download" | "close";
export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    quest: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 10h18m-13 5 3 3 5-5" /></>,
    create: <><path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6M3 17l5-5 4 4 3-3 6 6" /><circle cx="7.5" cy="8.5" r="1" fill="currentColor" stroke="none" /><path d="m18 2 1.4 3.6L23 7l-3.6 1.4L18 12l-1.4-3.6L13 7l3.6-1.4L18 2Z" /></>,
    roast: <><path d="M12 3c5.5 0 9 3.2 9 7.5S17.5 18 12 18H9l-6 4 1.6-7C3.5 13.8 3 12.3 3 10.5 3 6.2 6.5 3 12 3Z" /><path d="m7 8 2 1-2 1m10-2-2 1 2 1m-9 3q4 4 8 0" /></>,
    checkboard: <><path d="M7 3h12a2 2 0 0 1 2 2v12" /><rect x="3" y="6" width="15" height="15" rx="2.5" /><circle cx="10.5" cy="11.5" r="2" /><path d="M6.5 18a4 4 0 0 1 8 0" /></>,
    home: <path d="m3 10 9-8 9 8v11h-6v-7H9v7H3Z" fill="currentColor" strokeWidth="1" />,
    flame: <path d="M14 2c1 6-5 5-4 10-3-1-4-3-3-5-5 5-5 10-2 13 3 3 10 3 13-1 3-4 1-8-1-10 0 4-2 5-3 5 2-5 2-8 0-12Z" />,
    people: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3H3Zm13-17a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v2h-3" /></>,
    settings: <><path d="m10 2-.8 3-2 .9-2.8-.8-2 3.4 2.2 2.2v2.6l-2.2 2.2 2 3.4 2.8-.8 2 .9.8 3h4l.8-3 2-.9 2.8.8 2-3.4-2.2-2.2v-2.6l2.2-2.2-2-3.4-2.8.8-2-.9-.8-3Z" /><circle cx="12" cy="12" r="3.5" /></>,
    marketplace: <><path d="M4 10v11h16V10M3 10l2-7h14l2 7M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" /><path d="M9 21v-7h6v7" /></>,
    works: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="2" /><path d="m3 17 6-6 4 4 3-3 5 5" /></>,
    arrow: <path d="M5 19 19 5M5 5h14v14" />,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    spark: <path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" />,
    mask: <><path d="m2 8 10 3 10-3v7c-3 4-6 4-10 0-4 4-7 4-10 0V8Z" /><ellipse cx="7" cy="12" rx="2" ry="1" /><ellipse cx="17" cy="12" rx="2" ry="1" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    leaderboard: <path d="M4 21V12h5v9m0 0V4h6v17m0 0V9h5v12M2 21h20" />,
    logout: <path d="M10 4H4v16h6m4-12 4 4-4 4m-5-4h11" />,
    upload: <path d="M12 16V3m-5 5 5-5 5 5M3 15v5h18v-5" />,
    download: <path d="M12 3v13m-5-5 5 5 5-5M3 16v5h18v-5" />,
    close: <path d="m5 5 14 14M19 5 5 19" />,
  };
  return <svg aria-hidden="true" className={`ui-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function Smile({ className = "" }: { className?: string }) {
  return <svg aria-hidden="true" className={`smile-art ${className}`} viewBox="0 0 100 100" fill="currentColor" stroke="var(--foreground)" strokeWidth="2" strokeLinecap="round"><circle cx="50" cy="50" r="44" /><path d="M30 54q20 31 40 0M33 32v10m34-10v10" fill="none" /></svg>;
}

export function CameraArtwork() {
  return <svg aria-hidden="true" className="studio-illustration" viewBox="0 0 260 210" stroke="var(--foreground)" strokeWidth="2"><path d="M53 80h150v110H53z" fill="var(--background)" /><path d="m71 81 12-24h50l12 24" fill="var(--play-green)" /><circle cx="128" cy="133" r="37" fill="var(--play-blue)" /><circle cx="128" cy="133" r="24" fill="var(--background)" /><path d="m210 14 8 21 22 2-17 14 5 23-18-13-21 12 8-23-17-15 23 1Z" fill="var(--play-orange)" /><circle cx="179" cy="103" r="7" fill="var(--play-red)" /><path d="M18 130c-6-39 12-75 43-89m-1 0-23 0m23 0-3 20M180 210h53" fill="none" /></svg>;
}

export function EmptyImageArtwork() {
  return <svg aria-hidden="true" className="empty-art" viewBox="0 0 160 160" stroke="var(--foreground)" strokeWidth="1.5"><path d="M25 35h110v90H25z" fill="var(--background)" /><circle cx="59" cy="61" r="11" fill="var(--play-orange)" /><path d="m25 112 36-28 21 16 29-39 24 39" fill="var(--play-green)" /><path d="m132 4 5 10 11 3-8 8 1 12-9-6-11 4 4-11-6-9 12-1Z" fill="var(--play-blue)" /></svg>;
}

export function ColorPlay({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`color-play ${className}`}><span /><span /><span /><span /></span>;
}
