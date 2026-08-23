import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/auth/roles";
import {
  recordContactReveal,
  setContactRevealWriter,
  type ContactRevealRow,
} from "./contact-reveal";

const buyer: Actor = { id: "user_buyer", roles: ["buyer"] };
let rows: ContactRevealRow[];

beforeEach(() => {
  rows = [];
  setContactRevealWriter({
    write: async (row) => {
      rows.push(row);
    },
  });
});

afterEach(() => {
  setContactRevealWriter(null);
  vi.restoreAllMocks();
});

describe("recordContactReveal", () => {
  it("writes the event that proves the platform delivered the enquiry", async () => {
    await recordContactReveal({
      actor: buyer,
      businessId: "biz_1",
      locationId: "loc_1",
      channel: "phone",
      surface: "storefront",
    });
    expect(rows[0]).toEqual({
      actorId: "user_buyer",
      businessId: "biz_1",
      locationId: "loc_1",
      channel: "phone",
      surface: "storefront",
    });
  });

  it("counts an anonymous reveal — most happen before signup", async () => {
    await recordContactReveal({
      actor: null,
      businessId: "biz_1",
      channel: "whatsapp",
      surface: "search_results",
    });
    expect(rows[0]!.actorId).toBeNull();
    expect(rows[0]!.locationId).toBeNull();
  });

  it("never blocks the reveal when the write fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setContactRevealWriter({
      write: async () => {
        throw new Error("database unreachable");
      },
    });
    // Losing one counter row is cheaper than losing the enquiry it exists to prove.
    await expect(
      recordContactReveal({ actor: buyer, businessId: "biz_1", channel: "phone", surface: "storefront" }),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
  });

  it("is a no-op rather than a throw when no writer is configured", async () => {
    setContactRevealWriter(null);
    await expect(
      recordContactReveal({ actor: buyer, businessId: "biz_1", channel: "phone", surface: "storefront" }),
    ).resolves.toBeUndefined();
  });
});
