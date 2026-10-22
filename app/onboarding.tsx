"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { finishOnboarding } from "./profile/actions";
import { logout } from "./auth/actions";
import { StateSelect } from "./state-select";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { PhotoInput } from "./photo-input";
import { isUSState } from "@/lib/us-states";

const inputClass = "mt-2 w-full rounded-xl border border-current/25 bg-transparent px-4 py-3";

export function Onboarding({ firstName, lastName, stateCode, preview = false }: { firstName: string; lastName: string; stateCode: string; preview?: boolean }) {
  const pathname = usePathname();
  const suppressed = !preview && pathname === "/test/onboarding";
  const [finished, setFinished] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(0);
  const [first, setFirst] = useState(firstName);
  const [last, setLast] = useState(lastName);
  const [error, setError] = useState("");
  const [photoName, setPhotoName] = useState("");
  const [state, action, pending] = useActionState(finishOnboarding, {});
  useEffect(() => {
    if (suppressed) return;
    const element = dialog.current;
    element?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { element?.close(); document.body.style.overflow = previous; };
  }, [suppressed]);
  useEffect(() => { heading.current?.focus(); }, [step]);

  function next(skipPhoto = false) {
    const element = form.current!;
    if (step === 0) {
      for (const name of ["first_name", "last_name"]) {
        const input = element.elements.namedItem(name) as HTMLInputElement;
        if (!input.value.trim() || !input.checkValidity()) {
          setError("Please enter both your first and last name."); input.focus(); return;
        }
      }
    }
    if (step === 1) {
      const photo = element.elements.namedItem("photo") as HTMLInputElement;
      if (skipPhoto) { photo.value = ""; setPhotoName(""); }
      const file = photo.files?.[0];
      if (!skipPhoto && !file) return;
      if (file && (file.size > 2 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
        setError("Choose a JPG, PNG, or WebP photo up to 2 MB, or skip for now."); return;
      }
    }
    setError(""); setStep(step + 1);
  }
  if (suppressed) return null;
  return <dialog ref={dialog} onCancel={(event) => event.preventDefault()} aria-labelledby="welcome-title" className="design-dialog onboarding-dialog">
    {preview && <p className="mb-5 rounded-xl bg-foreground/5 p-3 text-sm">Test mode · No account is created. Answers and photos are not saved or uploaded.</p>}
    {finished ? <div className="space-y-5">
      <h2 id="welcome-title" className="text-3xl font-bold">You’re ready for your journey!</h2>
      <p>You completed all three steps. In the real flow, this is when your profile is created and your account unlocks.</p>
      <button onClick={() => { setFinished(false); setPhotoName(""); setFirst(""); setLast(""); setError(""); setStep(0); }} className="rounded-full bg-foreground px-6 py-3 font-semibold text-background">Test again</button>
      <Link href="/" className="block text-sm underline">Back to checked</Link>
    </div> : <>
    <p className="text-xs font-semibold uppercase tracking-widest opacity-60">Welcome to checked · {step + 1} / 3</p>
    <div className="my-5 flex gap-2" aria-hidden="true">{[0, 1, 2].map((index) => <span key={index} className={`h-1 flex-1 rounded-full ${index <= step ? "bg-foreground" : "bg-foreground/15"}`} />)}</div>
    <h2 ref={heading} tabIndex={-1} id="welcome-title" className="text-3xl font-bold outline-none">{["What should we call you?", "Identify the usual suspect.", "Where should we send the blame?"][step]}</h2>
    <p className="mt-3 text-sm leading-relaxed opacity-65">{["Every great joke starts with an introduction.", "Add your photo, or save your grand reveal for later.", "Plant your flag. Pick the state you’re repping in our corner of the internet."][step]}</p>
    <form noValidate ref={form} onReset={() => setPhotoName("")} action={preview ? undefined : action} onKeyDown={(event) => { if (event.key === "Enter" && step < 2 && event.target instanceof HTMLInputElement && event.target.type !== "file") { event.preventDefault(); next(); } }} onSubmit={(event) => { if (step !== 2) { event.preventDefault(); next(); } else { const stateInput = form.current!.elements.namedItem("state_code") as HTMLSelectElement; if (!isUSState(stateInput.value)) { event.preventDefault(); setError("Choose a US state to represent."); stateInput.focus(); } else if (preview) { event.preventDefault(); setFinished(true); } } }} className="mt-7 space-y-6">
      <fieldset hidden={step !== 0} disabled={pending} className={step === 0 ? "grid gap-4 sm:grid-cols-2" : "hidden"}>
        <label className="text-sm font-medium">First name<input name="first_name" autoComplete="given-name" value={first} onChange={(event) => setFirst(event.target.value)} required maxLength={100} className={inputClass} /></label>
        <label className="text-sm font-medium">Last name<input name="last_name" autoComplete="family-name" value={last} onChange={(event) => setLast(event.target.value)} required maxLength={100} className={inputClass} /></label>
      </fieldset>
      <fieldset hidden={step !== 1} disabled={pending}>
        <p className="text-sm font-medium">Profile photo <span className="opacity-60">(optional)</span></p>
        <PhotoInput fileName={photoName} onSelect={setPhotoName} disabled={pending} describedBy="welcome-photo-help" />
        <p id="welcome-photo-help" className="mt-3 text-xs opacity-60">JPG, PNG, or WebP · Up to 2 MB · Cropped to a square</p>
      </fieldset>
      <fieldset hidden={step !== 2} disabled={pending}><StateSelect id="welcome-state" value={stateCode} /></fieldset>
      {(error || state.error) && <p role="alert" className="text-sm text-red-600">{error || state.error} You can go back to revise your answers.</p>}
      <div className="flex flex-wrap items-center gap-3">
        {step > 0 && <button type="button" disabled={pending} onClick={() => { setError(""); setStep(step - 1); }} className="rounded-full border border-current/20 px-4 py-3 text-sm">Back</button>}
        {step < 2 ? <button type="button" disabled={step === 1 && !photoName} onClick={() => next()} className="flex-1 rounded-full bg-foreground px-6 py-3 font-semibold text-background disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 dark:disabled:bg-gray-700 dark:disabled:text-gray-400">Next</button> : <button disabled={pending} className="flex-1 rounded-full bg-foreground px-6 py-3 font-semibold text-background disabled:opacity-50">{pending ? "Saving…" : "accept accountability!"}</button>}
      </div>
      {step === 1 && <button type="button" onClick={() => next(true)} className="block w-full text-sm underline underline-offset-4">Skip for now</button>}
    </form>
    {preview ? <Link href="/" className="mt-6 block text-center text-xs underline">Exit test</Link> : <form action={logout} className="mt-6 text-center"><button className="text-xs opacity-60 hover:underline">Log out</button></form>}
    </>}
  </dialog>;
}
