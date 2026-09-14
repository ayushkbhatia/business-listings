import { createClient } from "@vercel/global-config";
import { parseWindow, type MaintenanceWindow } from "./window";

/**
 * Where the proxy reads the window record from.
 *
 * ## Two sources, and why the live one wins
 *
 * **Global Config** (formerly Edge Config), key `maintenance`, when a store is
 * connected to the project. Vercel writes the connection string to
 * `GLOBAL_CONFIG` — `EDGE_CONFIG` on a store connected before the rename. A
 * change propagates in seconds with no deploy.
 *
 * **`MAINTENANCE_WINDOW`**, a JSON environment variable, otherwise. It is what
 * the handoff calls "baked into the page at deploy", and it is what local runs
 * and the gallery use.
 *
 * The environment variable has a hole the store does not, and it is the reason
 * the store is preferred rather than merely supported: changing it needs a
 * deploy, and a deploy runs `check:schema-deployed` and prerenders pages that
 * read Postgres. Both need the database — the thing a window is usually taken
 * for. So a record baked at deploy can be set before the work and cannot be
 * moved during it. An overrun can still never pass silently (the page switches
 * to *running past 03:00* by itself), but only the store can give it a new end
 * time.
 *
 * ## Failure is open
 *
 * A record that does not parse, or a store that cannot be reached, leaves the
 * site as it is and logs why. A maintenance switch that can take the directory
 * down by being misread is worse than one that occasionally fails to. `pnpm
 * maintenance:check` exists so a record is read back before the window, not
 * discovered wrong during it.
 */

export const GLOBAL_CONFIG_KEY = "maintenance";

/** A read is reused this long. Reads are billed, and a window is planned in hours. */
const FRESH_MS = 15_000;
/** When the store cannot be reached, the last good answer holds this long. */
const STALE_IF_ERROR_MS = 5 * 60_000;

interface Cached {
  at: number;
  window: MaintenanceWindow | null;
}

let storeCache: Cached | null = null;
let envCache: { raw: string; window: MaintenanceWindow | null } | null = null;
const reported = new Set<string>();

function reportOnce(key: string, message: string) {
  if (reported.has(key)) return;
  reported.add(key);
  console.error(`[maintenance] ${message}`);
}

function fromRaw(raw: unknown, origin: string): MaintenanceWindow | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const result = parseWindow(raw);
  if (result.ok) return result.window;
  reportOnce(
    `${origin}:${typeof raw === "string" ? raw : JSON.stringify(raw)}`,
    `${origin} holds a record that does not parse, so no window is served: ${result.errors.join("; ")}`,
  );
  return null;
}

function connectionString(): string | undefined {
  return process.env["GLOBAL_CONFIG"] || process.env["EDGE_CONFIG"] || undefined;
}

export async function readMaintenanceWindow(now: number = Date.now()): Promise<MaintenanceWindow | null> {
  const connection = connectionString();

  if (connection) {
    if (storeCache && now - storeCache.at < FRESH_MS) return storeCache.window;
    try {
      const raw = await createClient(connection).get(GLOBAL_CONFIG_KEY);
      storeCache = { at: now, window: fromRaw(raw, `Global Config key "${GLOBAL_CONFIG_KEY}"`) };
      return storeCache.window;
    } catch (error) {
      reportOnce(`store-error:${Math.floor(now / STALE_IF_ERROR_MS)}`, `Global Config could not be read: ${String(error)}`);
      if (storeCache && now - storeCache.at < STALE_IF_ERROR_MS) return storeCache.window;
      return null;
    }
  }

  const raw = process.env["MAINTENANCE_WINDOW"] ?? "";
  if (envCache?.raw !== raw) {
    envCache = { raw, window: fromRaw(raw, "MAINTENANCE_WINDOW") };
  }
  return envCache.window;
}

/** Tests only. The caches are module state, and every test wants a cold one. */
export function resetMaintenanceSourceForTests() {
  storeCache = null;
  envCache = null;
  reported.clear();
}
