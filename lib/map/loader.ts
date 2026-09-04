/**
 * One way in to MapLibre, for the three maps that use it.
 *
 * MapLibre is around 800 KB and a tile stream that never goes quiet, so it is
 * imported dynamically at the point a map is actually mounted rather than in the
 * page's first chunk. All three maps did that already; what they did not do was
 * agree on where the library's Web Worker lives, because none of them knew there
 * was a question.
 *
 * ## Why WORKER_URL is set here
 *
 * MapLibre resolves its worker at runtime with
 * `new URL("./maplibre-gl-worker.mjs", import.meta.url)`, assembling the
 * filename from a ternary that no bundler can read statically. Nothing emits the
 * file, `import.meta.url` is the app's own chunk, and the worker 404s — which
 * MapLibre reports as one line in the console about a MIME type and then a blank
 * map with working controls. Every map on this platform was in that state.
 *
 * `config.WORKER_URL` is MapLibre's documented answer, and `scripts/copy-map-worker.mts`
 * is the other half: it copies the worker and its shared chunk into
 * `public/maplibre/` before `dev` and before `build`, from `node_modules`, so
 * the served copy can never be a version behind the bundled one.
 *
 * Set once per document, before the first `new Map`, and idempotent — three maps
 * on one page must not race to write the same string.
 */

/** Where `scripts/copy-map-worker.mts` puts it. Same string in both files. */
const WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";

type MapLibre = typeof import("maplibre-gl");

let loading: Promise<MapLibre> | null = null;

/** MapLibre, with its worker pointed somewhere that exists. */
export function loadMapLibre(): Promise<MapLibre> {
  loading ??= import("maplibre-gl").then((maplibre) => {
    /*
       `config` is the same object the worker reads once it starts, so this has
       to be set before the first map is constructed. Assigned rather than
       merged: MapLibre owns the rest of the object and a spread here would
       fight it.
    */
    maplibre.config.WORKER_URL = WORKER_URL;
    return maplibre;
  });
  return loading;
}
