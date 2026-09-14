import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPECIMEN_WINDOW as DRAWN } from "./specimen";

const get = vi.fn();
vi.mock("@vercel/global-config", () => ({ createClient: () => ({ get }) }));

const { maintenanceResponse } = await import("./respond");
const { readMaintenanceWindow, resetMaintenanceSourceForTests } = await import("./source");

const DURING = new Date("2026-09-20T02:30:00+04:00");
const request = (method = "GET") => new Request("https://businesslistings.me/search", { method });

beforeEach(() => {
  resetMaintenanceSourceForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  get.mockReset();
});

describe("maintenanceResponse", () => {
  it("answers 503 with Retry-After, no-store and noindex (B2)", async () => {
    vi.stubEnv("MAINTENANCE_WINDOW", JSON.stringify(DRAWN));
    const response = await maintenanceResponse(request(), "/search", DURING);
    expect(response?.status).toBe(503);
    expect(response?.headers.get("retry-after")).toBe("1800");
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("x-robots-tag")).toBe("noindex");
    expect(response?.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response?.text()).toContain("Back at 03:00 GST");
  });

  it("answers HEAD with the headers and no body", async () => {
    vi.stubEnv("MAINTENANCE_WINDOW", JSON.stringify(DRAWN));
    const response = await maintenanceResponse(request("HEAD"), "/search", DURING);
    expect(response?.status).toBe(503);
    expect(await response?.text()).toBe("");
  });

  it("passes a route no down system owns", async () => {
    vi.stubEnv("MAINTENANCE_WINDOW", JSON.stringify(DRAWN));
    expect(await maintenanceResponse(request(), "/enquiry/abc", DURING)).toBeNull();
  });

  it("fails open on a record it cannot read, and says why once", async () => {
    vi.stubEnv("MAINTENANCE_WINDOW", JSON.stringify({ ...DRAWN, whatsapp: "+971 4 000 0000" }));
    expect(await maintenanceResponse(request(), "/search", DURING)).toBeNull();
    expect(await maintenanceResponse(request(), "/search", DURING)).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.error).mock.calls[0]?.[0]).toMatch(/UAE mobile/);
  });
});

describe("readMaintenanceWindow from Global Config", () => {
  it("prefers the store, and reuses a read for fifteen seconds", async () => {
    vi.stubEnv("GLOBAL_CONFIG", "https://edge-config.vercel.com/ecfg_x?token=y");
    vi.stubEnv("MAINTENANCE_WINDOW", "");
    get.mockResolvedValue(DRAWN);
    const t0 = DURING.getTime();
    expect((await readMaintenanceWindow(t0))?.id).toBe(DRAWN.id);
    await readMaintenanceWindow(t0 + 10_000);
    expect(get).toHaveBeenCalledTimes(1);
    await readMaintenanceWindow(t0 + 16_000);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith("maintenance");
  });

  it("reads EDGE_CONFIG, the name a store connected before the rename writes", async () => {
    vi.stubEnv("GLOBAL_CONFIG", "");
    vi.stubEnv("EDGE_CONFIG", "https://edge-config.vercel.com/ecfg_x?token=y");
    get.mockResolvedValue(undefined);
    expect(await readMaintenanceWindow(DURING.getTime())).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("keeps the last good answer through a store outage, then lets it go", async () => {
    vi.stubEnv("GLOBAL_CONFIG", "https://edge-config.vercel.com/ecfg_x?token=y");
    const t0 = DURING.getTime();
    get.mockResolvedValueOnce(DRAWN);
    await readMaintenanceWindow(t0);
    get.mockRejectedValue(new Error("network"));
    expect((await readMaintenanceWindow(t0 + 60_000))?.id).toBe(DRAWN.id);
    expect(await readMaintenanceWindow(t0 + 6 * 60_000)).toBeNull();
  });
});
