import documentFixtures from "../../../samples/documents.json";
import type { FindingInput } from "./review-service";

// Server-only: the sample findings are private fake-AI input, never public data.
// This module must not be imported from client code.

type FixtureFinding = {
  clause: string | null;
  title: string;
  severity: string;
  excerpt: string | null;
  explanation: string;
};

function toFindingInputs(findings: FixtureFinding[]): FindingInput[] {
  return findings.map((finding, position) => ({
    position,
    clause: finding.clause,
    title: finding.title,
    severity: finding.severity as FindingInput["severity"],
    excerpt: finding.excerpt,
    explanation: finding.explanation,
  }));
}

const findingsByDocumentId = new Map<string, FindingInput[]>(
  documentFixtures.map((document) => [
    document.id,
    toFindingInputs(document.findings as FixtureFinding[]),
  ]),
);

/**
 * Returns the private source findings for a document in source order, or
 * `undefined` when no fixture exists for it (a missing fixture fails only the
 * accepted review, per M2-REQ-7). A document with no findings maps to `[]`.
 */
export function findingsForDocument(
  documentId: string,
): FindingInput[] | undefined {
  return findingsByDocumentId.get(documentId);
}
