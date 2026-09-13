import { describe, expect, it } from "vitest";
import {
  ENQUIRY_ATTACHMENT_BYTES,
  SCALE_MAX,
  checkEnquiryAttachment,
  checkServiceEnquiry,
  displayFilename,
  enquiryAttachmentPath,
  isEnquiryAttachmentPath,
  serviceLine,
  uaeToday,
  type ServiceEnquiryDraft,
} from "./service-enquiry";

/** Board `1d-s` — the enquiry that asks about a situation, not a quantity. */

const offered = ["statutory-audit", "vat-return-filing"];
const today = "2026-09-13";

const draft: ServiceEnquiryDraft = {
  service: "statutory-audit",
  requirement: "FY2025 audit for a contracting company, three projects.",
  scale: "AED 20–50m turnover",
  neededBy: "",
  attachment: null,
  contactPhone: null,
};

describe("checkServiceEnquiry", () => {
  it("accepts the render's own enquiry and cleans it", () => {
    expect(checkServiceEnquiry({ ...draft, scale: "  AED  20–50m   turnover " }, offered, today)).toEqual({
      ok: true,
      value: {
        serviceSlug: "statutory-audit",
        requirement: "FY2025 audit for a contracting company, three projects.",
        scale: "AED 20–50m turnover",
        neededBy: null,
      },
    });
  });

  it("asks no quantity at all — there is no field to refuse", () => {
    expect(Object.keys(draft)).not.toContain("qty");
  });

  it("accepts *something not listed* as no service", () => {
    const result = checkServiceEnquiry({ ...draft, service: "" }, offered, today);
    expect(result.ok && result.value.serviceSlug).toBeNull();
  });

  it("refuses a service the firm does not offer live, rather than guessing", () => {
    const result = checkServiceEnquiry({ ...draft, service: "transfer-pricing" }, offered, today);
    expect(result).toEqual({ ok: false, refusals: [{ field: "service", reason: "not_offered" }] });
  });

  it("returns every refusal, not the first", () => {
    const result = checkServiceEnquiry(
      {
        ...draft,
        requirement: "audit",
        scale: "x".repeat(SCALE_MAX + 1),
        neededBy: "2026-09-12",
        attachment: { type: "application/vnd.ms-excel", bytes: 2000 },
        contactPhone: " ",
      },
      offered,
      today,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.refusals.map((r) => `${r.field}:${r.reason}`)).toEqual([
      "requirement:too_short",
      "scale:too_long",
      "neededBy:past",
      "attachment:type",
      "contact:missing",
    ]);
  });

  it("takes today as a needed-by date and stores it at UTC midnight", () => {
    const result = checkServiceEnquiry({ ...draft, neededBy: today }, offered, today);
    expect(result.ok && result.value.neededBy?.toISOString()).toBe("2026-09-13T00:00:00.000Z");
  });

  it("refuses a date that is not one", () => {
    const result = checkServiceEnquiry({ ...draft, neededBy: "13/09/2026" }, offered, today);
    expect(!result.ok && result.refusals).toEqual([{ field: "neededBy", reason: "invalid" }]);
  });

  it("does not ask a signed-in buyer for a phone", () => {
    expect(checkServiceEnquiry({ ...draft, contactPhone: null }, offered, today).ok).toBe(true);
  });
});

describe("checkEnquiryAttachment — Q1, optional and fenced", () => {
  it("takes a PDF, a JPEG or a PNG up to ten megabytes", () => {
    expect(checkEnquiryAttachment("application/pdf", 1024)).toBeNull();
    expect(checkEnquiryAttachment("image/png", ENQUIRY_ATTACHMENT_BYTES)).toBeNull();
  });

  it("refuses anything else, and anything larger or empty", () => {
    expect(checkEnquiryAttachment("text/html", 10)).toEqual({ field: "attachment", reason: "type" });
    expect(checkEnquiryAttachment("application/pdf", ENQUIRY_ATTACHMENT_BYTES + 1)).toEqual({
      field: "attachment",
      reason: "size",
    });
    expect(checkEnquiryAttachment("application/pdf", 0)).toEqual({ field: "attachment", reason: "size" });
  });
});

describe("serviceLine", () => {
  it("carries the service in as the subject, with no quantity", () => {
    expect(serviceLine({ id: "svc_1", name: "Statutory audit" }, "anything")).toEqual({
      description: "Statutory audit",
      qty: null,
      serviceId: "svc_1",
    });
  });

  it("names a not-listed enquiry from the first sentence the buyer wrote", () => {
    expect(serviceLine(null, "Group consolidation for two subsidiaries. Previous auditor left.")).toEqual({
      description: "Group consolidation for two subsidiaries.",
      qty: null,
      serviceId: null,
    });
    expect(serviceLine(null, "y".repeat(300)).description).toHaveLength(120);
  });
});

describe("attachment paths", () => {
  it("derives the path from the enquiry, and accepts only its own", () => {
    const path = enquiryAttachmentPath("enq_1", "Trial Balance FY25.pdf");
    expect(path).toMatch(/^enquiries\/enq_1\/trial-balance-fy25-[a-z0-9]{1,6}\.pdf$/);
    expect(isEnquiryAttachmentPath("enq_1", path)).toBe(true);
    expect(isEnquiryAttachmentPath("enq_2", path)).toBe(false);
    expect(isEnquiryAttachmentPath("enq_1", "enquiries/enq_1/../enq_2/x.pdf")).toBe(false);
    expect(isEnquiryAttachmentPath("enq_1", "biz_1/certificate/x.pdf")).toBe(false);
  });

  it("keeps the buyer's filename readable and bounded", () => {
    expect(displayFilename("  folder/Trial balance.pdf ")).toBe("folder Trial balance.pdf");
    expect(displayFilename("")).toBe("attachment");
    expect(displayFilename("a".repeat(200)).length).toBeLessThanOrEqual(121);
  });
});

describe("uaeToday", () => {
  it("is the Dubai calendar date, not UTC's", () => {
    expect(uaeToday(new Date("2026-09-12T21:30:00.000Z"))).toBe("2026-09-13");
    expect(uaeToday(new Date("2026-09-12T19:30:00.000Z"))).toBe("2026-09-12");
  });
});
