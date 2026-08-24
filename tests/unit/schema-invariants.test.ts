import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Acceptance criterion 9, as a test rather than only a shell script — CI has no
 * database, so this reads the schema text. The three shapes below are each a
 * migration to undo, which is why they are guarded in three places: here, in
 * scripts/check-schema-invariants.sh, and in the schema comments themselves.
 */
const schema = readFileSync("prisma/schema.prisma", "utf8");

/** Schema minus comments — the file documents the bans in prose. */
const code = schema
  .split("\n")
  .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("///"))
  .join("\n");

function modelBody(name: string): string {
  const match = new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, "m").exec(code);
  if (!match) throw new Error(`No model ${name} in the schema`);
  return match[1]!;
}

describe("no price on a public surface", () => {
  it("the buyer's target price is on EnquiryLine, never on Product", () => {
    expect(modelBody("EnquiryLine")).toMatch(/^\s*targetUnitPriceAed\s+Decimal\?/m);
    expect(modelBody("Product")).not.toMatch(/target/i);
  });

  it("Product has no price, currency or tier-pricing field", () => {
    const body = modelBody("Product");
    expect(body).not.toMatch(/^\s*price\s/m);
    expect(body).not.toMatch(/^\s*(unitPrice|priceAed|listPrice|msrp)\s/m);
    expect(body).not.toMatch(/^\s*currency\s/m);
    expect(body).not.toMatch(/^\s*(pricingTier|tierPricing|priceBreaks)\s/m);
  });

  it("QuoteLine.unitPrice is the only product price in the schema", () => {
    expect(modelBody("QuoteLine")).toMatch(/^\s*unitPrice\s+Decimal/m);

    // Three price fields exist and each earns it:
    //   unitPrice           a supplier's price, private to one quote
    //   monthlyPriceAed     what we charge a seller, ours not theirs
    //   targetUnitPriceAed  what a buyer hopes to pay, their own budget,
    //                       private to the enquiry and never public
    // Nothing else may be added without the same kind of justification.
    const priceFields = [...code.matchAll(/^\s*(\w*[Pp]rice\w*)\s+\w/gm)].map((m) => m[1]);
    expect(new Set(priceFields)).toEqual(
      new Set(["unitPrice", "monthlyPriceAed", "targetUnitPriceAed"]),
    );
  });
});

describe("not e-commerce", () => {
  it("has no order, payment, fulfilment or cart model", () => {
    for (const forbidden of ["Order", "OrderLine", "Payment", "Fulfilment", "Fulfillment", "Cart", "Checkout", "Shipment"]) {
      expect(code, forbidden).not.toMatch(new RegExp(`^model ${forbidden}\\s`, "m"));
    }
  });

  it("has no payout, commission, transaction fee or escrow anywhere", () => {
    expect(code).not.toMatch(/payout|commissionRate|transactionFee|escrow/i);
  });

  it("names no forbidden enum value from the CLAUDE.md vocabulary table", () => {
    expect(code).not.toMatch(/^enum (OrderStatus|PaymentStatus)\b/m);
  });
});

describe("verification is platform-owned", () => {
  it("keeps verificationTier on Business with no seller-writable twin", () => {
    expect(modelBody("Business")).toMatch(/^\s*verificationTier\s+Int/m);
    expect(code).not.toMatch(/claimedVerificationTier|selfVerified|verificationRequestTier/);
  });

  it("computes response time and never accepts it as input", () => {
    const body = modelBody("Business");
    expect(body).toMatch(/^\s*responseTimeMedianMs\s+Int\?/m);
    expect(body).not.toMatch(/responseTimeClaimed|advertisedResponse/);
  });
});

describe("audit", () => {
  it("has a non-nullable reason", () => {
    const body = modelBody("AuditEvent");
    expect(body).toMatch(/^\s*reason\s+String\s*$/m);
    expect(body).not.toMatch(/^\s*reason\s+String\?/m);
  });

  it("keeps before and after so a change can be read back", () => {
    const body = modelBody("AuditEvent");
    expect(body).toMatch(/^\s*before\s+Json\?/m);
    expect(body).toMatch(/^\s*after\s+Json\?/m);
  });
});

describe("the shapes later handoffs depend on", () => {
  it("carries zero_result_query, which handoff 1 writes on every empty search", () => {
    expect(code).toMatch(/^model ZeroResultQuery\s/m);
  });

  it("lets a location be unpinned, so it can be excluded from maps", () => {
    const body = modelBody("Location");
    expect(body).toMatch(/^\s*lat\s+Float\?/m);
    expect(body).toMatch(/^\s*lng\s+Float\?/m);
  });

  it("keeps a seller template mapped back to the platform field", () => {
    expect(modelBody("SellerTemplate")).toMatch(/^\s*platformTemplateId\s+String/m);
    expect(modelBody("SellerTemplate")).toMatch(/^\s*fieldMappings\s+Json/m);
  });

  it("marks spec fields filterable, so the rail is data not code", () => {
    expect(modelBody("SpecField")).toMatch(/^\s*isFilterable\s+Boolean/m);
  });
});

describe("the availability vocabulary", () => {
  it("uses the four states the design system names, and no backorder", () => {
    const enumBody = /^enum Availability \{([\s\S]*?)^\}/m.exec(code)?.[1] ?? "";
    for (const value of ["in_stock", "made_to_order", "indent", "out_of_stock"]) {
      expect(enumBody, value).toContain(value);
    }
    expect(enumBody).not.toMatch(/backorder/i);
  });
});
