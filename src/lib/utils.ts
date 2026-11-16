import clsx, { type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

const LAGOS = "Africa/Lagos";

export function formatDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: LAGOS }).format(date);
}

export function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeZone: LAGOS }).format(date);
}

export function relativeTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = (date.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return formatDate(date);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function humanize(s: string) {
  return s.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Read a single string search param. */
export function sp(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : undefined;
}

export function pageParam(v: string | string[] | undefined) {
  const n = Number(sp(v) ?? 1);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}
