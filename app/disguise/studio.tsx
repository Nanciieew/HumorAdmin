"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { peekDisguiseDraft, clearDisguiseDraft } from "@/lib/disguise-draft";
import { isUuid } from "@/lib/gallery-types";
import type { FactoryPreview } from "@/lib/factory/types";
import { usePathname, useRouter } from "next/navigation";
import styles from "./studio.module.css";

function FactoryModal({ label, children, onClose }: { label: string; children: ReactNode; onClose?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className={styles.modal} aria-label={label} onCancel={event => { event.preventDefault(); onClose?.(); }}>{children}</dialog>;
}
function LabLoader() {
  return <div className={styles.loader} aria-hidden="true"><svg viewBox="0 0 120 120" fill="none"><circle className={styles.loaderTrack} cx="60" cy="60" r="52"/><circle className={styles.loaderArc} cx="60" cy="60" r="52"/><circle cx="60" cy="60" r="25" stroke="currentColor" strokeWidth="2"/><path d="m47 57 13 12 16-18M48 45h1m24 0h1" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg></div>;
}

export function DisguiseStudio({ configured, userId }: { configured: boolean; userId: string }) {
  const [source, setSource] = useState<{ image: string; name: string } | null>(() => peekDisguiseDraft());
  const router = useRouter();
  const pathname = usePathname();
  const previewScreen = pathname === "/disguise/preview";
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [direction, setDirection] = useState("");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<FactoryPreview | null>(null);
  const [selected, setSelected] = useState(0);
  const [photoId, setPhotoId] = useState("");
  const [celebrating, setCelebrating] = useState(false);
  const [error, setError] = useState("");
  const [publishError, setPublishError] = useState("");
  const [recoverable, setRecoverable] = useState(false);
  const request = useRef<AbortController | null>(null);
  const reader = useRef<FileReader | null>(null);
  const mounted = useRef(false), inFlight = useRef(false), publishingRef = useRef(false);
  const batchId = useRef<string | null>(null), version = useRef(0);
  const storageKey = `checked:factory-batch:${userId}`;
  function remember(id: string | null) {
    batchId.current = id;
    try { if (id) sessionStorage.setItem(storageKey, id); else sessionStorage.removeItem(storageKey); } catch { /* The active batch still works without storage. */ }
  }
  function acceptPreview(data: FactoryPreview) {
    if (!isUuid(data.id) || !Array.isArray(data.variants) || data.variants.length !== 5 || data.variants.some(variant => typeof variant.caption !== "string" || typeof variant.url !== "string" || (variant.url && !variant.url.startsWith("https://")))) throw new Error("The previews couldn’t be loaded. Please try again.");
    setResult(data); setSelected(data.selected ?? 0); setConfirmed(data.selected !== null); setPhotoId(data.photoId ?? ""); setRecoverable(false);
  }
  const restore = useCallback(async (id: string, signal?: AbortSignal) => {
    const token = version.current;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/factory/${id}`, { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn’t restore your previews.");
      if (mounted.current && token === version.current && !signal?.aborted) acceptPreview(data);
    } catch (cause) {
      if (mounted.current && token === version.current && !signal?.aborted) { setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : "Couldn’t load your previews. Please try again."); setRecoverable(true); }
    } finally { if (mounted.current && token === version.current && !signal?.aborted) setBusy(false); }
  }, []);
  useEffect(() => { if (source) clearDisguiseDraft(source.image); }, [source]);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    return () => { mounted.current = false; controller.abort(); request.current?.abort(); reader.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!previewScreen || result || inFlight.current) return;
    const controller = new AbortController();
    let savedId: string | null = null;
    try { savedId = sessionStorage.getItem(storageKey); } catch { /* Browser storage is optional. */ }
    const timer = window.setTimeout(() => {
      if (inFlight.current) return;
      if (isUuid(savedId)) { batchId.current = savedId; void restore(savedId, controller.signal); }
      else router.replace("/disguise");
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [storageKey, restore, previewScreen, result, router]);
  useEffect(() => {
    if (!result) return;
    const previews = result.variants.filter(variant => variant.url).map(variant => {
      const image = new window.Image(); image.src = variant.url; return image;
    });
    return () => { for (const image of previews) image.src = ""; };
  }, [result]);
  async function discard(id: string) {
    const response = await fetch(`/api/factory/${id}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404 && response.status !== 410) {
      const data = await response.json(); throw new Error(data.error || "Couldn’t clear the previous previews. Please retry.");
    }
  }
  function choosePhoto(file: File | null) {
    const token = ++version.current; reader.current?.abort();
    setSource(null); setResult(null); setPhotoId(""); setConfirmed(false); setError(""); setReading(false);
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type) || !file.size || file.size > 2 * 1024 * 1024) { setError("Choose a JPG or PNG meme picture up to 2 MB."); return; }
    setReading(true);
    const next = new FileReader(); reader.current = next;
    next.onload = () => {
      if (!mounted.current || token !== version.current) return;
      setReading(false);
      if (typeof next.result !== "string") { setError("Couldn’t read that picture. Try another file."); return; }
      setSource({ image: next.result, name: file.name });
    };
    next.onerror = () => { if (mounted.current && token === version.current) { setReading(false); setError("Couldn’t read that picture. Try another file."); } };
    next.readAsDataURL(file);
  }
  async function generate() {
    if (!source || !configured || inFlight.current || publishingRef.current) return;
    inFlight.current = true; setBusy(true); setGenerating(true); setError(""); setPublishError("");
    router.push("/disguise/preview", { scroll: false });
    const token = ++version.current;
    const controller = new AbortController(); request.current = controller;
    try {
      if (batchId.current) await discard(batchId.current);
      if (!mounted.current || token !== version.current) return;
      setResult(null); setPhotoId(""); setConfirmed(false); setRecoverable(false);
      const id = crypto.randomUUID(); remember(id);
      const response = await fetch("/api/factory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, image: source.image, direction: direction.trim(), approved: true }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(190_000)]) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn’t generate your memes. Please try again.");
      if (mounted.current && token === version.current) acceptPreview(data);
    } catch (cause) {
      if (mounted.current && token === version.current && !controller.signal.aborted) { setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : "Couldn’t finish this batch. Try loading its previews before generating again."); setRecoverable(!!batchId.current); }
    } finally { if (mounted.current && token === version.current) { inFlight.current = false; setBusy(false); setGenerating(false); request.current = null; } }
  }
  async function cancel() {
    version.current++; request.current?.abort(); inFlight.current = false;
    const id = batchId.current;
    setBusy(false); setGenerating(false); setError("");
    router.push("/disguise", { scroll: false });
    if (id) try { await discard(id); remember(null); setRecoverable(false); } catch { setError("Generation stopped here. Cached previews will expire automatically."); }
  }
  async function publish() {
    if (!result || publishingRef.current || photoId || busy) return;
    publishingRef.current = true; setPublishing(true); setConfirmed(true); setPublishError("");
    const index = selected;
    try {
      const response = await fetch(`/api/factory/${result.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selected: index, approved: true }) });
      const data = await response.json();
      if (!response.ok || !isUuid(data.photoId)) throw new Error(data.error || "Couldn’t publish your meme. Please retry.");
      if (mounted.current) {
        setPhotoId(data.photoId);
        setCelebrating(true);
        setResult(previous => previous ? { ...previous, selected: index, photoId: data.photoId, variants: previous.variants.map((variant, position) => position === index ? variant : { ...variant, url: "" }) } : previous);
        try { sessionStorage.setItem("checked:gallery-votes-changed", "1"); } catch { /* The gallery also refreshes on focus. */ }
      }
    } catch (cause) { if (mounted.current) setPublishError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : "Publishing could not be confirmed. Retry with this caption to finish publishing and cleanup."); }
    finally { publishingRef.current = false; if (mounted.current) setPublishing(false); }
  }
  async function startOver() {
    if (inFlight.current || publishingRef.current) return;
    setError(""); setPublishError("");
    // Defer discarding the cached batch until Create meme is clicked again.
    // Going back or forward can still restore the current selection.
    router.push("/disguise", { scroll: false });
  }
  function createAnother() {
    if (inFlight.current || publishingRef.current) return;
    version.current++;
    remember(null);
    setCelebrating(false); setSource(null); setResult(null); setPhotoId("");
    setConfirmed(false); setSelected(0); setDirection(""); setError(""); setPublishError(""); setRecoverable(false);
    router.push("/disguise", { scroll: false });
  }
  const locked = busy || publishing;
  const variant = result?.variants[selected];
  const errorPanel = error && <div role="alert" className={styles.error}><span>{error}</span>{recoverable && !busy && <button onClick={() => { if (batchId.current) void restore(batchId.current); }}>Try loading again</button>}</div>;
  return <main id="main" data-factory-screen={previewScreen ? "preview" : "upload"} className={styles.factory}>
    <div className={styles.topbar}><span className={styles.topbarMark} aria-hidden="true">⌁</span><span>Checked <b>Factory</b></span></div>
    {(busy || publishing) && <FactoryModal label={publishing ? "Publishing your meme" : generating ? "Creating your memes" : "Loading your memes"} onClose={generating ? () => void cancel() : undefined}>
      <LabLoader /><p className={styles.modalTitle} role="status">{publishing ? "Publishing your meme…" : generating ? "Creating your memes…" : "Loading your memes…"}</p>
      {generating && <button className={styles.cancelGeneration} onClick={() => void cancel()}>Cancel</button>}
    </FactoryModal>}
    {celebrating && <FactoryModal label="Meme published" onClose={() => setCelebrating(false)}>
      <button className={styles.closeModal} aria-label="Close success window" onClick={() => setCelebrating(false)}>×</button>
      <div className={styles.checkedStamp} role="status" aria-label="Meme published. CHECKED">
        <div className={styles.checkHalo} aria-hidden="true"><svg viewBox="0 0 140 140" fill="none"><circle className={styles.checkRing} cx="70" cy="70" r="60" /><circle className={styles.checkTicks} cx="70" cy="70" r="53"/><path className={styles.checkStroke} pathLength="1" d="m39 71 21 22 43-47" /></svg></div>
        <span>CHECKED</span>
      </div>
      <div className={styles.publishedActions}><button className={styles.createAnother} onClick={createAnother}>Create Another Meme</button><Link className={styles.primary} href={`/gallery?sort=newest#photo-${photoId}`}>View in gallery</Link></div>
    </FactoryModal>}
    {previewScreen && !generating ? <>
      <header className={styles.previewHeader}>
        <button className={styles.back} disabled={locked} onClick={() => void startOver()} aria-label="Back to upload">← <span>New meme</span></button>
        <h1>Make it yours<span>.</span></h1>
        <span className={styles.microcopy}>SAME PHOTO<br />DIFFERENT ENERGY</span>
      </header>
      {errorPanel}
      <div className={styles.workspace}>
        <section className={styles.preview} aria-label="Meme preview" aria-busy={busy}>
          {variant?.url || source ? <div className={styles.picture}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={variant?.url || source?.image} src={variant?.url || source?.image} alt={variant ? `Meme preview: ${variant.caption}` : "Your uploaded meme picture"} />

          </div> : <div className={styles.empty} role="status"><span aria-hidden="true">✳</span><p>{busy ? "Loading your memes…" : "Your preview will appear here."}</p></div>}
          {variant && <span className={styles.previewCount}>{selected + 1} / 5</span>}
        </section>
        <section className={styles.captions} aria-labelledby="captions-title">
          <div className={styles.panelHeader}><h2 id="captions-title">Pick your caption</h2><span>{photoId ? "PUBLISHED" : "5 CAPTIONS"}</span></div>
          {result ? <div className={styles.options} role="group" aria-label="Choose a caption">{result.variants.map((option, index) => <button key={index} className={styles.option} aria-pressed={selected === index} disabled={locked || confirmed || !!photoId} onClick={() => setSelected(index)}><span className={styles.number}>{String(index + 1).padStart(2, "0")}</span><span>{option.caption}</span><span className={styles.selected} aria-hidden="true">{selected === index ? "✓" : ""}</span></button>)}</div> : <div className={styles.placeholders} aria-label="Captions are being created">{Array.from({ length: 5 }, (_, index) => <div key={index}><span>{String(index + 1).padStart(2, "0")}</span><i /></div>)}</div>}
          <div className={styles.publish}>
            {publishError && <p role="alert" className={styles.error}>{publishError}</p>}
            {photoId ? !celebrating && <div className={styles.publishedActions}><button className={styles.createAnother} onClick={createAnother}>Create Another Meme</button><Link className={styles.primary} href={`/gallery?sort=newest#photo-${photoId}`}>View in gallery <span aria-hidden="true">↗</span></Link></div> : <button className={styles.primary} disabled={!result || locked} onClick={() => void publish()}>{publishing ? "Publishing…" : confirmed ? "Retry publishing" : "Publish to gallery"}<span aria-hidden="true">→</span></button>}
          </div>
        </section>
      </div>
    </> : <div className={styles.uploadPage}>
      <header className={styles.hero}><h1>Make it a meme<span>.</span></h1><span className={styles.microcopy}>TURN MOMENTS<br />INTO MEMES</span></header>
      <div className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`} role="group" aria-label="Photo upload"
        onDragOver={event => { event.preventDefault(); if (!locked) setDragging(true); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={event => { event.preventDefault(); setDragging(false); if (!locked && !reading) choosePhoto(event.dataTransfer.files[0] ?? null); }}>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png" aria-label="Choose meme picture" className={styles.fileInput} disabled={locked || reading} onChange={event => { choosePhoto(event.target.files?.[0] ?? null); event.target.value = ""; }} />
        <button className={styles.dropButton} type="button" disabled={locked || reading} onClick={() => fileInput.current?.click()} aria-label={source ? "Replace photo" : "Upload photo"}>
          {source ? <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={source.image} alt="Your uploaded meme picture" /><span className={styles.replace}>Replace photo ↗</span>
          </> : <><span className={styles.uploadIcon} aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><rect x="4" y="5" width="24" height="22" rx="4" stroke="currentColor" strokeWidth="1.5" /><circle cx="12" cy="12" r="2" fill="currentColor" /><path d="m5 23 7-7 5 5 4-4 6 6M23 3v8m-4-4 4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></span><strong>{reading ? "Reading your photo…" : dragging ? "Drop it here" : "Upload or drag a photo"}</strong><span className={styles.fileHelp}>JPG or PNG · 2 MB max</span></>}
        </button>
      </div>
      <div className={styles.uploadActions}><div className={styles.keyword}><label htmlFor="factory-direction">Keyword <span>(optional)</span></label><input id="factory-direction" maxLength={500} placeholder="Finals week, first dates, office life…" value={direction} disabled={locked} onChange={event => setDirection(event.target.value)} /></div>
      {!configured && <p role="alert" className={styles.error}>Meme creation is currently unavailable.</p>}
      {errorPanel}
      <button className={styles.primary} disabled={!configured || !source || reading || locked} onClick={() => void generate()}>Create meme <span aria-hidden="true">→</span></button></div>
    </div>}
  </main>;
}
