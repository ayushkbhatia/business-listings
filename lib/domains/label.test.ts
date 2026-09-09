import { describe, expect, it } from "vitest";
import {
  checkLabel,
  hostnameFor,
  labelFor,
  labelFromHost,
  MAX_LABEL,
  RESERVED_LABELS,
  SUBDOMAIN_ZONE,
} from "./label";

/**
 * The rules the proxy enforces with no database to ask.
 *
 * `proxy.ts` turns a `Host` header into a path by string work alone, so every
 * one of these is load-bearing at the edge of the request rather than somewhere
 * a server component could correct it later.
 */

describe("the label a slug earns", () => {
  it("drops the hyphens, because the address is read aloud and typed", () => {
    expect(labelFor("indus-hydraulics")).toBe("indushydraulics");
    expect(labelFor("al-marwan-industrial-supplies-llc")).toBe("almarwanindustrialsuppliesllc");
  });

  it("lowercases, and keeps digits", () => {
    expect(labelFor("Aquaforce-Pump-Trading-5")).toBe("aquaforcepumptrading5");
  });

  it("is lossy, which is why the label is stored rather than recomputed", () => {
    // Two different suppliers, one label. The service refuses the second as
    // `taken` rather than handing out a near-miss of the address they asked for.
    expect(labelFor("indus-hydraulics")).toBe(labelFor("indushydraulics"));
  });
});

describe("what a label may be", () => {
  it("accepts an ordinary one", () => {
    expect(checkLabel("indushydraulics")).toBeNull();
  });

  it("refuses an empty label", () => {
    expect(checkLabel("")).toBe("empty");
    // A slug of nothing but punctuation flattens to nothing at all.
    expect(checkLabel(labelFor("---"))).toBe("empty");
  });

  it("refuses anything DNS would not carry", () => {
    expect(checkLabel("indus_hydraulics")).toBe("not_a_label");
    expect(checkLabel("indus.hydraulics")).toBe("not_a_label");
    expect(checkLabel("INDUS")).toBe("not_a_label");
    expect(checkLabel("-indus")).toBe("not_a_label");
  });

  it("refuses a label longer than DNS allows", () => {
    expect(checkLabel("a".repeat(MAX_LABEL))).toBeNull();
    expect(checkLabel("a".repeat(MAX_LABEL + 1))).toBe("too_long");
  });

  it("refuses every route segment this app serves", () => {
    // The one that would actually hurt: a listing sitting where staff expect a
    // console is how somebody gets phished.
    for (const taken of ["admin", "dashboard", "api", "staff", "signin", "b", "c", "search"]) {
      expect(checkLabel(taken), taken).toBe("reserved");
    }
  });

  it("refuses the hostnames infrastructure owns", () => {
    for (const taken of ["www", "mail", "mx", "cdn", "stores"]) {
      expect(checkLabel(taken), taken).toBe("reserved");
    }
  });

  it("reserves every segment the public route tree actually has", () => {
    // Pinned as a set rather than a count, so adding a top-level route and
    // forgetting to reserve it fails here instead of in production.
    for (const segment of [
      "b", "c", "categories", "search", "compare", "guides", "best", "lp",
      "rfq", "enquiry", "account", "review", "pricing",
    ]) {
      expect(RESERVED_LABELS.has(segment), segment).toBe(true);
    }
  });
});

describe("the label a Host header names", () => {
  const host = (label: string) => `${label}.${SUBDOMAIN_ZONE}`;

  it("reads a storefront label", () => {
    expect(labelFromHost(host("indushydraulics"))).toBe("indushydraulics");
  });

  it("ignores the port a development host carries", () => {
    expect(labelFromHost(`${host("indushydraulics")}:3000`)).toBe("indushydraulics");
  });

  it("is case-insensitive, because a Host header's case is not guaranteed", () => {
    expect(labelFromHost(`INDUSHYDRAULICS.${SUBDOMAIN_ZONE.toUpperCase()}`)).toBe(
      "indushydraulics",
    );
  });

  it("returns null for the apex, so the directory keeps routing normally", () => {
    expect(labelFromHost(SUBDOMAIN_ZONE)).toBeNull();
  });

  it("returns null for www", () => {
    expect(labelFromHost(host("www"))).toBeNull();
  });

  it("returns null for a reserved label", () => {
    expect(labelFromHost(host("admin"))).toBeNull();
  });

  it("returns null outside our zone", () => {
    expect(labelFromHost("indushydraulics.example.com")).toBeNull();
    // The suffix has to be the zone, not merely end with its letters.
    expect(labelFromHost("notbusinesslistings.me")).toBeNull();
  });

  it("returns null for a deeper name than a storefront has", () => {
    // A wildcard certificate covers one level. Two would mismatch, and the
    // label rewritten to would be one nobody was given.
    expect(labelFromHost(`a.b.${SUBDOMAIN_ZONE}`)).toBeNull();
  });

  it("returns null for nothing at all", () => {
    expect(labelFromHost(null)).toBeNull();
    expect(labelFromHost(undefined)).toBeNull();
    expect(labelFromHost("")).toBeNull();
  });
});

describe("the hostname a label resolves to", () => {
  it("sits directly under the zone", () => {
    expect(hostnameFor("indushydraulics")).toBe(`indushydraulics.${SUBDOMAIN_ZONE}`);
  });

  it("round-trips through the host reader", () => {
    expect(labelFromHost(hostnameFor("indushydraulics"))).toBe("indushydraulics");
  });
});
