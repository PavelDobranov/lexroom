import type { WorkspaceSnapshot } from "../shared/api";

type Lawyer = WorkspaceSnapshot["lawyers"][number];

export const SELECTED_LAWYER_STORAGE_KEY = "lexroom.selected-lawyer-id";

const selectionListeners = new Set<() => void>();
let inMemorySelection: string | null = null;

export function readSelectedLawyerId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SELECTED_LAWYER_STORAGE_KEY);
  } catch {
    return inMemorySelection;
  }
}

export function writeSelectedLawyerId(lawyerId: string): void {
  inMemorySelection = lawyerId;
  try {
    window.localStorage.setItem(SELECTED_LAWYER_STORAGE_KEY, lawyerId);
  } catch {
    // The in-memory selection remains usable when persistence is blocked.
  }
  selectionListeners.forEach((listener) => listener());
}

export function subscribeToSelectedLawyer(listener: () => void): () => void {
  selectionListeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === SELECTED_LAWYER_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    selectionListeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

/**
 * Resolves the lawyer to work as: the stored selection when it still matches a
 * known lawyer, otherwise the first server-ordered lawyer (or null when none).
 */
export function resolveSelectedLawyerId(
  lawyers: Lawyer[],
  candidateId: string | null,
): string | null {
  if (candidateId && lawyers.some(({ id }) => id === candidateId)) {
    return candidateId;
  }
  return lawyers[0]?.id ?? null;
}
