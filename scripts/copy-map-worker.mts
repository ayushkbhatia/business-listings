/**
 * Put MapLibre's worker where the browser can fetch it.
 *
 * ## The bug this fixes
 *
 * Every map on the platform rendered a blank grey rectangle: the storefront's
 * branches, board 1c's results, and board 2d's branch pin. The controls, the
 * attribution and the markers were all there and correctly placed. No tiles.
 *
 * MapLibre does its tile work in a Web Worker, and it locates that worker at
 * runtime — `new URL("./maplibre-gl-worker.mjs", import.meta.url)` inside the
 * bundled `maplibre-gl.mjs`. The filename is assembled from a ternary, so no
 * bundler can see it statically and none of them emit the file. In the browser
 * `import.meta.url` is the app's own chunk, and the worker URL resolves to
 * `/_next/static/chunks/maplibre-gl-worker.mjs`, which is a 404. The console
 * says only *"Failed to load module script: the server responded with a
 * non-JavaScript MIME type of text/html"* — the dev server's 404 page — and the
 * map fails silently from there: no worker, no tile parsing, no paint, no error
 * on the map instance.
 *
 * ## The fix
 *
 * Copy the worker and the shared chunk it imports into `public/maplibre/`, and
 * point `maplibregl.config.WORKER_URL` at them — `lib/map/loader.ts` does that
 * half. `WORKER_URL` is MapLibre's own documented escape hatch for exactly this
 * situation, so nothing here is patched or monkeyed.
 *
 * ## Why a copy rather than a committed file
 *
 * A vendored copy in `public/` is a second version of MapLibre that upgrades
 * cannot reach: `pnpm up maplibre-gl` would move the main bundle and leave a
 * worker from the previous major behind it, and the two halves talk to each
 * other over a private protocol. So the copy is generated before `dev` and
 * before `build`, and `public/maplibre/` is git-ignored. The file on disk is
 * always the one in `node_modules`.
 *
 * Both files are needed: the worker imports `./maplibre-gl-shared.mjs` as a
 * sibling, so serving one without the other fails the same way, one import
 * later.
 */
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** The two halves, in the order they are loaded. */
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"] as const;

const OUT = join(process.cwd(), "public", "maplibre");

async function main(): Promise<void> {
  let dist: string;
  try {
    dist = dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
  } catch {
    /*
       Not installed. A no-op rather than a failure: this runs before `dev` and
       `build`, and a fresh clone that has not run `pnpm install` should be told
       that by the install, not by a copy step it has never heard of.
    */
    console.warn("[map] maplibre-gl is not installed; the worker was not copied.");
    return;
  }

  await mkdir(OUT, { recursive: true });
  for (const file of FILES) {
    await copyFile(join(dist, file), join(OUT, file));
  }

  const version = JSON.parse(
    await readFile(require.resolve("maplibre-gl/package.json"), "utf8"),
  ) as { version: string };
  console.log(`[map] worker ${version.version} copied to public/maplibre/`);
}

await main();
