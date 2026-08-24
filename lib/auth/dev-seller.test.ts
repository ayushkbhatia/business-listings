import { describe, expect, it } from "vitest";
import { devSellerRequest } from "./dev-seller";

describe("devSellerRequest", () => {
  it("is inert in production even when the variable is set", () => {
    // The whole point. If this ever returns a value, anyone who can set an
    // environment variable can act as any seller.
    expect(devSellerRequest({ NODE_ENV: "production", DEV_SELLER_SLUG: "anything" })).toBeNull();
  });

  it("is inert when nobody asked for it", () => {
    expect(devSellerRequest({ NODE_ENV: "development" })).toBeNull();
    expect(devSellerRequest({ NODE_ENV: "development", DEV_SELLER_SLUG: "" })).toBeNull();
    expect(devSellerRequest({ NODE_ENV: "test", DEV_SELLER_SLUG: "  " })).toBeNull();
  });

  it("returns the slug in development and test, where the seed exists", () => {
    expect(devSellerRequest({ NODE_ENV: "development", DEV_SELLER_SLUG: "al-marwan-valves" }))
      .toEqual({ slug: "al-marwan-valves" });
    expect(devSellerRequest({ NODE_ENV: "test", DEV_SELLER_SLUG: "al-marwan-valves" }))
      .toEqual({ slug: "al-marwan-valves" });
  });
});
