import type { WorkspaceSnapshot } from "../../../shared/api";

type Lawyer = WorkspaceSnapshot["lawyers"][number];

export function LawyerPicker({
  lawyers,
  selectedLawyerId,
  onChange,
}: {
  lawyers: Lawyer[];
  selectedLawyerId: string;
  onChange: (lawyerId: string) => void;
}) {
  return (
    <div className="w-full max-w-sm">
      <label htmlFor="lawyer-selector" className="mb-2 block text-sm font-semibold text-slate-800">
        Working as
      </label>
      <select
        id="lawyer-selector"
        value={selectedLawyerId}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-900 shadow-sm outline-none transition focus:border-indigo-600 focus:ring-3 focus:ring-indigo-100"
      >
        {lawyers.map((lawyer) => (
          <option key={lawyer.id} value={lawyer.id}>
            {lawyer.name} — {lawyer.title}
          </option>
        ))}
      </select>
    </div>
  );
}
