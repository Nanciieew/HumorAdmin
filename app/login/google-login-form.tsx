"use client";

import { useActionState } from "react";
import { loginWithGoogle, type FormState } from "@/app/auth/actions";

export function GoogleLoginForm({ next = "/" }: { next?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(loginWithGoogle, {});
  return (
    <form action={action} className="mt-8 space-y-4"><input type="hidden" name="next" value={next} />
      {state.error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      <button disabled={pending} className="flex w-full items-center justify-center gap-3 rounded-xl border border-current/25 px-5 py-3 font-semibold transition hover:bg-foreground/5 disabled:opacity-50">
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.5-.2-2.2H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.3ZM12 22c2.7 0 5-1 6.6-2.5l-3.2-2.4c-.9.6-2 1-3.4 1a6 6 0 0 1-5.6-4.2H3.1v2.5A10 10 0 0 0 12 22ZM6.4 13.9a6 6 0 0 1 0-3.8V7.6H3.1a10 10 0 0 0 0 8.8l3.3-2.5ZM12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.5 9.5 0 0 0 12 2a10 10 0 0 0-8.9 5.6l3.3 2.5A6 6 0 0 1 12 5.9Z" /></svg>
        {pending ? "Connecting to Google…" : "Continue with Google"}
      </button>
    </form>
  );
}
