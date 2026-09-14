# Scheduled maintenance — the runbook

Board `13e`. How to put the directory, or part of it, behind the maintenance page for planned
work, and how to take it down again. The code is `lib/maintenance/`; the proxy's call is at the top
of `proxy.ts`.

---

## What happens during a window

- Every request to a route the window takes down is answered by `proxy.ts` itself: **HTTP 503**,
  `Retry-After` (seconds to the end time, or 300 once it has passed), `Cache-Control: no-store`,
  `X-Robots-Tag: noindex`, and the page as one HTML document. No route, layout, session refresh or
  database client runs.
- Routes a window does not take down answer as normal.
- `/api/*` is never intercepted, so the crons, the OTP hook and notification delivery keep running
  — which is what a *RUNNING* row on the page is claiming.
- `/maintenance` shows the recorded window from the moment it is set, including before it starts.
  With no window it is a 404.

## The record

```json
{
  "id": "2026-09-20-search-index",
  "work": "search_index",
  "startsAt": "2026-09-20T02:20:00+04:00",
  "endsAt": "2026-09-20T03:00:00+04:00",
  "affected": [
    { "system": "search", "state": "down" },
    { "system": "requirements", "state": "down" },
    { "system": "quotes", "state": "running" },
    { "system": "notifications", "state": "running" }
  ],
  "whatsapp": "+971 50 118 4400"
}
```

| Field | Rule |
|---|---|
| `id` | Lowercase, digits, hyphens. Names the window in logs |
| `work` | `search_index` · `notification_job` · `database`. Names the work in the page's sentence. **`database` takes every page down**; the other two take down only the routes of the systems marked `down` |
| `startsAt`, `endsAt` | ISO 8601 **with the zone**. At most 24 hours apart. The page shows the end in GST |
| `affected` | One row per system, in the order the page lists them. Systems and the routes each owns are in `lib/maintenance/systems.ts` |
| `whatsapp` | Optional. A UAE **mobile** — a landline cannot receive WhatsApp. Set it only if somebody answers it for the whole window; without it the page draws no contact card |

| System | Row on the page | Routes it takes down |
|---|---|---|
| `search` | Search and filters | `/search`, `/c/*`, `/categories`, `/compare`, `/best/*`, `/:emirate/*` |
| `requirements` | Posting a new requirement | `/rfq/*` |
| `quotes` | Quotes already in flight | `/enquiry/*`, `/account/enquiries/*`, `/dashboard/leads/*`, `/dashboard/quotes/*` |
| `notifications` | Seller notifications | none — the job runs from `/api/jobs/*` |

A record the proxy cannot read is **ignored**, and the site stays up — so check it first. The
rules it enforces, each with the reason in its error message:

- work on the search index lists `search` down; work on the notification job lists `notifications` down;
- `database` work lists nothing as running;
- any other work lists at least one system running — *a status list that is all red is a status
  list nobody believes* — and takes at least one page down.

The sentence *enquiries already sent are safe and suppliers are still being notified* appears only
when `quotes` and `notifications` are both listed as running.

## Before the window

1. Write the record and read it back:

   ```bash
   pnpm maintenance:check window.json
   ```

   It prints the times in GST, what is taken down, the rows, whether the trust sentence shows, and
   the one-line JSON to paste. `--at <iso time>` checks it as of a moment; `--html out.html` writes
   the page.

2. Put the one-line JSON where the proxy reads it:

   - **Global Config** (preferred), key `maintenance`, in the store connected to the project.
     Changes reach every region within about ten seconds and need no deploy. Vercel names the
     connection `GLOBAL_CONFIG`, or `EDGE_CONFIG` for a store connected before the rename.
   - **`MAINTENANCE_WINDOW`**, a production environment variable, when no store is connected. A
     change needs a deploy — and a deploy needs the database, so this can only be set before the
     work starts and removed after it ends. It cannot move an end time mid-window.

3. Open `https://businesslistings.me/maintenance` and read the page as a visitor will. Confirm the
   WhatsApp line is staffed.

## During

- The proxy re-reads the store every 15 seconds. `curl -sI https://businesslistings.me/search`
  shows the `503` and `Retry-After`.
- **Running over:** at the end time the page switches to *Running past 03:00 GST* on its own, and
  an open tab switches to *Due back at 03:00 GST* and asks the visitor to reload. Give it a new
  `endsAt` in the store as soon as there is one.
- Two hours past `endsAt` the window is treated as lifted and logged: planned work that far over is
  an incident, and this page must not keep saying *planned*.

## After

Delete the `maintenance` key (or the environment variable, then deploy). `/maintenance` returns
404 again.

## Open

- **Q2** — no admin screen owns the record. `12h` is its home.
- **Q4** — sellers are not told a window is coming.
