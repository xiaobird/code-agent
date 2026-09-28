// src/util/wildcard.ts
export function wildcardMatch(pattern: string, value: string): boolean {
  const regex = new RegExp("^" + pattern.split("*").map(escapeRegex).join(".*") + "$")
  return regex.test(value)
}
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
