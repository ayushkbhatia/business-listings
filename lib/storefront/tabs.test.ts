import { describe, expect, it } from "vitest";
import { sellsGoods, sellsWork, storefrontTabs, tabRoutes, type StorefrontTabCounts } from "./tabs";

/**
 * Board `1d-s` B1 and B2, and board 1d's criterion 9 — one definition of the
 * tab row, shared by the header, the tab routes and the sitemap.
 */

const full: StorefrontTabCounts = {
  products: 12,
  services: 4,
  credentials: 6,
  locations: 1,
  reviews: 34,
};

const none: StorefrontTabCounts = {
  products: 0,
  services: 0,
  credentials: 0,
  locations: 0,
  reviews: 0,
};

describe("storefrontTabs", () => {
  it("gives a services business no catalogue tab, even with leftover products — B1", () => {
    expect(storefrontTabs("services", full)).toEqual([
      "overview",
      "services",
      "credentials",
      "branches",
      "reviews",
    ]);
  });

  it("gives `both` the catalogue and the services as separate tabs — B2", () => {
    expect(storefrontTabs("both", full)).toEqual([
      "overview",
      "products",
      "services",
      "credentials",
      "branches",
      "reviews",
    ]);
  });

  it("keeps a goods storefront exactly as it was, with no credentials tab", () => {
    expect(storefrontTabs("goods", full)).toEqual([
      "overview",
      "products",
      "services",
      "branches",
      "reviews",
    ]);
    expect(storefrontTabs("unset", { ...full, services: 0 })).toEqual([
      "overview",
      "products",
      "branches",
      "reviews",
    ]);
  });

  it("hides every tab at zero and keeps overview — criterion 9", () => {
    expect(storefrontTabs("services", none)).toEqual(["overview"]);
    expect(storefrontTabs("both", none)).toEqual(["overview"]);
  });

  it("omits the reviews tab when there are none — the `No reviews` state", () => {
    expect(storefrontTabs("services", { ...full, reviews: 0 })).not.toContain("reviews");
  });
});

describe("tabRoutes", () => {
  it("is the tab row without the overview, which is the page itself", () => {
    expect(tabRoutes("services", full)).toEqual(["services", "credentials", "branches", "reviews"]);
  });
});

describe("sellsWork / sellsGoods", () => {
  it("splits the four declarations the way the storefront needs", () => {
    expect([sellsWork("unset"), sellsWork("goods"), sellsWork("services"), sellsWork("both")]).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect([sellsGoods("unset"), sellsGoods("goods"), sellsGoods("services"), sellsGoods("both")]).toEqual([
      true,
      true,
      false,
      true,
    ]);
  });
});
