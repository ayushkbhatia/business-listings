import { describe, expect, it } from "vitest";
import { isSafeNext, signInHref } from "./next-path";

/*
   `isSafeNext` was covered only by tests/integration/auth-flow.test.ts, which
   refuses to run without a DATABASE_URL — so a same-origin path check that
   exists to prevent an open redirect was unreachable in the suite that runs on
   every save. Moving it out of the server-only module makes it unit-testable,
   and this is that test. The integration case stays where it is: it asserts the
   sign-in flow, not the string.
*/

describe("isSafeNext", () => {
  it("accepts a same-origin absolute path", () => {
    expect(isSafeNext("/account/enquiries")).toBe(true);
    expect(isSafeNext("/search?q=valve&emirate=dubai")).toBe(true);
  });

  it("refuses everything that could leave the origin", () => {
    for (const hostile of [
      "//evil.example",
      "https://evil.example",
      "http://evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "evil.example",
    ]) {
      expect(isSafeNext(hostile), hostile).toBe(false);
    }
  });
});

describe("signInHref", () => {
  it("encodes the path it carries back", () => {
    expect(signInHref("/account/saved/shortlist")).toBe(
      "/signin?next=%2Faccount%2Fsaved%2Fshortlist",
    );
  });

  it("keeps a query string whole", () => {
    // Unencoded, the first `&` would end the `next` parameter and the buyer
    // would come back to a search missing every filter after the first.
    const href = signInHref("/search?q=valve&emirate=dubai");
    expect(href).toBe("/signin?next=%2Fsearch%3Fq%3Dvalve%26emirate%3Ddubai");
    expect(new URL(href, "https://businesslistings.me").searchParams.get("next")).toBe(
      "/search?q=valve&emirate=dubai",
    );
  });

  it("sends a hostile next to the directory home rather than off-site", () => {
    for (const hostile of ["//evil.example", "https://evil.example", "\\\\evil.example"]) {
      expect(signInHref(hostile), hostile).toBe("/signin?next=%2F");
    }
  });

  it("agrees with the literals it replaced", () => {
    // The two paths that were percent-encoded by hand at their call sites.
    expect(signInHref("/account/enquiries")).toBe("/signin?next=%2Faccount%2Fenquiries");
    expect(signInHref("/account/saved")).toBe("/signin?next=%2Faccount%2Fsaved");
  });
});
