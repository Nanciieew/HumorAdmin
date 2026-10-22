"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { saveProfile, type ProfileState } from "./actions";
import { US_STATES } from "@/lib/us-states";
import styles from "./profile.module.css";

export function ProfileEditor({ firstName, lastName, photoUrl, stateCode }: {
  firstName: string; lastName: string; photoUrl: string | null; stateCode: string;
}) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(saveProfile, {});
  const [photoName, setPhotoName] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const photo = preview || photoUrl;
  return <form noValidate action={action} className={styles.layout} onReset={() => { setPhotoName(""); setPreview(null); }}>
    <section className={styles.identity} aria-label="Profile photo">
      <div className={styles.photoCard}>
        {photo ? <Image src={photo} alt="Your profile photo" width={600} height={700} unoptimized /> : <div className={styles.initials} aria-label="No profile photo">{firstName.slice(0, 1)}{lastName.slice(0, 1)}</div>}
        <span className={styles.clip} aria-hidden="true"><svg viewBox="0 0 48 76" fill="none"><path d="m24 35-9 28a8 8 0 0 0 15 5l10-31" stroke="currentColor" strokeWidth="5" strokeLinecap="round"/><circle cx="26" cy="21" r="16" fill="currentColor"/><circle cx="26" cy="21" r="11" stroke="#1d280e" strokeWidth="2"/><path d="M21 25q5 5 10-2m-11-7h1m9 0h1" stroke="#1d280e" strokeWidth="2.5" strokeLinecap="round"/></svg></span>
      </div>
      <input ref={input} type="file" name="photo" hidden accept="image/jpeg,image/png,image/webp" disabled={pending} onChange={event => { const file = event.target.files?.[0]; setPhotoName(file?.name ?? ""); setPreview(file ? URL.createObjectURL(file) : null); }} />
      <button type="button" className={styles.changePhoto} disabled={pending} aria-label="Choose profile photo" aria-describedby="photo-help photo-name" onClick={() => input.current?.click()}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 14v6h16v-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>Change photo</button>
      <p id="photo-help" className={styles.photoHelp}>JPG, PNG or WebP · Up to 2 MB</p>
      <p id="photo-name" role="status" className={styles.photoName}>{photoName}</p>
    </section>
    <section className={styles.panel} aria-labelledby="profile-title">
      <p className={styles.eyebrow}>THE USUAL SUSPECT</p>
      <header className={styles.heading}><h1 id="profile-title">My profile<span>.</span></h1><Link href="/gallery">View gallery <span aria-hidden="true">→</span></Link></header>
      <div className={styles.nameFields}>
        <div><label htmlFor="first_name">First name</label><input id="first_name" name="first_name" defaultValue={firstName} autoComplete="given-name" required maxLength={100} disabled={pending}/></div>
        <div><label htmlFor="last_name">Last name</label><input id="last_name" name="last_name" defaultValue={lastName} autoComplete="family-name" required maxLength={100} disabled={pending}/></div>
      </div>
      <div className={styles.stateField}><label htmlFor="state_code">State</label><select id="state_code" name="state_code" defaultValue={stateCode} required disabled={pending}><option value="">Choose your state</option>{US_STATES.map(([code,name]) => <option key={code} value={code}>{name}</option>)}</select><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 9 7 7 7-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
      {state.error && <p role="alert" className={styles.error}>{state.error}</p>}
      {state.success && <p role="status" className={styles.success}>Your profile has been saved.</p>}
      <button disabled={pending} className={styles.save}>{pending ? "Saving…" : "Save changes"}</button>
    </section>
  </form>;
}
