"use client";

export default function AdminErrorPage({ reset }: { reset: () => void }) {
  return <section role="alert"><h2>Admin data couldn’t load.</h2><p>Check your filters or try again. Access must be verified before any data is shown.</p><button onClick={reset}>Try again</button></section>;
}
