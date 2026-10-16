import type { FindingSnapshot } from "../../../shared/api";

function SeverityTag({ severity }: { severity: "low" | "medium" | "high" }) {
  const styles = {
    high: "bg-rose-50 text-rose-700",
    medium: "bg-amber-50 text-amber-700",
    low: "bg-slate-100 text-slate-700",
  } as const;

  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${styles[severity]}`}>
      {severity}
    </span>
  );
}

export type FindingsListProps = {
  findings: FindingSnapshot[];
};

export function FindingsList({ findings }: FindingsListProps) {
  return (
    <ul className="mt-4 space-y-3">
      {findings.map((finding) => (
        <li key={finding.position} className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-950">
              {finding.clause ? `${finding.clause} — ` : ""}
              {finding.title}
            </h4>
            <SeverityTag severity={finding.severity} />
          </div>
          {finding.excerpt && (
            <blockquote className="mt-2 border-l-2 border-slate-300 pl-3 text-sm italic text-slate-600">
              {finding.excerpt}
            </blockquote>
          )}
          <p className="mt-2 text-sm text-slate-700">{finding.explanation}</p>
        </li>
      ))}
    </ul>
  );
}
