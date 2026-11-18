export function JsonDetails({ value, label = "Details" }: { value: unknown; label?: string }) {
  if (value == null || (typeof value === "object" && Object.keys(value as object).length === 0)) return <span className="text-xs text-muted">—</span>;
  return (
    <details className="group text-xs">
      <summary className="cursor-pointer select-none text-navy-600 hover:underline">{label}</summary>
      <pre className="mt-2 max-h-72 max-w-[36rem] overflow-auto rounded-lg bg-navy-950 p-3 font-mono text-[11px] leading-relaxed text-navy-100">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
