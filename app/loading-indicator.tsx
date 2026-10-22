import styles from "./loading-indicator.module.css";

export function ContentLoading({ label = "Loading…" }: { label?: string }) {
  return <div className={styles.content} role="status" aria-label={label} aria-busy="true">
    <span className={styles.spinner} aria-hidden="true" />
    <span>Loading…</span>
  </div>;
}

export function PageLoading() {
  return <main id="main" className={styles.page}><ContentLoading label="Loading page" /></main>;
}
