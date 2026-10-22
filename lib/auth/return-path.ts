export function returnPath(value: unknown) {
  if (typeof value !== "string" || value.length > 500 || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) return "/";
  return value;
}

// Only admin destinations change the app's established post-login welcome flow.
export function adminReturnPath(value: unknown) {
  const path = returnPath(value);
  return path === "/admin" || path.startsWith("/admin/") || path.startsWith("/admin?") ? path : null;
}
