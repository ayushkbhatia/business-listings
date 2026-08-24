# Kickoff prompt — Handoff 3

Paste below the line into Claude Code, in the repo produced by handoffs 0–2.

---

Read `handoff-3-seller-dashboard/README.md` in full, plus `CLAUDE.md`,
`docs/design-system.md` §07 (client column) and `docs/data-model.md` from the existing repo.

You are building **handoff 3: seller onboarding and dashboard** — the path that turns 41,000
imported records into a paying supply side. A supplier finds their own listing, proves they
own it, fills it in, and runs it daily without talking to us.

**The shape:** onboarding is linear and finishes; everything after it is a loop. The dashboard
opens on what needs a reply, never on a chart.

Build in this order — dashboard first, onboarding last. The dashboard is where a seller spends
their life and it is harder; the five-screen funnel into it is much easier once you know what
it must produce.

**1. Overview, both plans.** `[3a]` Pro and `[11a]` Free. The Free board is the upgrade
funnel, not a degraded Pro — it lists the enquiries missed because of the 3-a-month cap, with
dates and requirements. Locked panels show the real feature dimmed with one line naming what
unlocks it.
**Checkpoint: both overviews, and a locked panel.**

**2. The catalogue loop.** `[3f]` list with bulk actions, `[3g]` template-driven editor with
`FILTER` markers, `[3h]` cloned spec template with mapping preserved, `[3i]` media, `[11d]`
CSV mapper.
**Checkpoint: import a CSV containing a price column and show me it blocked with the reason.**

**3. Listing maintenance.** `[3b]` `[3c]` `[3d]` `[3e]`. Build `HoursEditor` and
`EmirateAreaPicker` here. Only trade name, category and licence changes queue for moderation —
everything else publishes instantly.

**4. Account.** `[3l]` analytics, `[3m]` billing, `[7d]` team and lead routing, `[11e]`
sponsored placement, `[11f]` plan change / cancel / invoice. Build `PlanCard` — it completes
all 64 components. No commission anywhere; no retention offer on cancel.

**5. Onboarding and setup.** `[2a]`–`[2e]` then `[8a]`–`[8e]`. The listing goes live on Free
before the plan screen. All four setup tasks independent and resumable.

**6. Acceptance pass.** Walk the twelve criteria and show me each.

Four rules that decide whether this works — they are in the README, read them first:
the free dashboard is a designed argument not a degraded one · spec templates are cloned with
the mapping preserved · the CSV importer must refuse to import prices · moderation is narrow
or it becomes the bottleneck on 41,000 listings.

If anything is ambiguous, stop and ask rather than picking.
