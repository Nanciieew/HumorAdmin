export function adminSearchParams(input: Record<string, string | string[] | undefined>) {
  return new URLSearchParams(Object.entries(input).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : []));
}
