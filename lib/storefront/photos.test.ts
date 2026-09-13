import { describe, expect, it } from "vitest";
import { storefrontPhotos } from "./photos";

const media = [
  { id: "c", kind: "cover" },
  ...Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, kind: "gallery" })),
];

describe("storefrontPhotos", () => {
  it("cuts at the plan's own number", () => {
    expect(storefrontPhotos({ id: "free", publicPhotoLimit: 2 }, media).map((m) => m.id)).toEqual(["g0", "g1"]);
  });

  it("shows every gallery photo where the plan has no cut", () => {
    expect(storefrontPhotos({ id: "pro", publicPhotoLimit: null }, media)).toHaveLength(6);
  });

  it("treats a listing with no plan row as Free", () => {
    expect(storefrontPhotos(null, media)).toHaveLength(3);
  });

  it("never counts the cover as a gallery photo", () => {
    expect(storefrontPhotos({ id: "pro", publicPhotoLimit: null }, media).some((m) => m.kind === "cover")).toBe(false);
  });
});
