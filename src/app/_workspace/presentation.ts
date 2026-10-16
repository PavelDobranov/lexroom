/** Presents a document type: known acronyms verbatim, otherwise Title Case. */
export function formatDocumentType(type: string): string {
  const normalized = type.trim().toLowerCase();
  if (normalized === "nda") return "NDA";
  if (normalized === "saas") return "SaaS";
  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatUploadDate(uploadedAt: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(uploadedAt));
}
