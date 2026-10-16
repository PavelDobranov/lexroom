import { describe, expect, it } from "vitest";

import { formatDocumentType } from "./presentation";

describe("document type presentation", () => {
  it("formats familiar acronyms and open-text types", () => {
    expect(formatDocumentType("nda")).toBe("NDA");
    expect(formatDocumentType("saas")).toBe("SaaS");
    expect(formatDocumentType("master-services_agreement")).toBe(
      "Master Services Agreement",
    );
  });
});
