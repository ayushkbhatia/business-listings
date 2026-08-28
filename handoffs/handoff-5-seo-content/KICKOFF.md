# Kickoff prompt — Handoff 5

Paste below the line into Claude Code, in the repo produced by handoffs 0–4.

---

Read `handoff-5-seo-content/README.md` in full, plus `CLAUDE.md`, `docs/design-system.md` §08
(voice) and `docs/routes.md` from the existing repo.

You are building **handoff 5: the SEO layer** — the acquisition engine. 84 category×emirate
pages, ~418 subcategory pages, curated lists and 22 guides.

**The one rule this handoff exists to enforce:** a page publishes only above 60 listings and
30% verified, with 250 words of intro copy, and auto-unpublishes if supply drops below the
floor. The guard was built in handoff 1 and given a UI in handoff 4; this is where it does
real work. If a task proposes generating pages ahead of supply, the task is wrong — stop and
ask.

Build in this order, stopping for review at each checkpoint:

**1. Guides.** `[10b]` index and `[6d]` article. Self-contained, they earn the links the area
pages need to rank, and they work before supply density exists.
**Checkpoint: one guide with Article structured data and a working directory CTA.**

**2. Category index and subcategory pages.** `[6c]` and the SEO layer on `[10a]`. Pure data —
adding a subcategory must need no code change.
**Checkpoint: add a subcategory in the database and show the page appearing.**

**3. Area landing pages.** `[6a]`. FAQ answers grounded in platform data, not spun text.
Cross-links to the same trade elsewhere and other trades in the same area.
**Checkpoint: show me a page blocked by the threshold and the same page publishing once seed
data crosses it.**

**4. Curated lists.** `[6b]` with the selection criteria published on the page and placement
unbuyable — assert it with a test.

**5. Campaign and legal.** `[10i]` with UTM preserved through to the enquiry, `[10j]` legal
template for four pages.

**6. Technical layer.** Structured data per the README (Product omits price entirely, not as
an empty field), sitemaps of published pages only, canonicals from filtered views to area
pages, `/search` and `/compare` noindex, and the zero-result alert firing when a matching
product is later listed — that closes the flywheel.

**7. Acceptance pass.** Walk the twelve criteria and show me each.

Voice matters more here than anywhere — these pages are read by strangers deciding whether to
trust us. Say the number. Never spin. The 250-word intro floor exists to make sure a human
actually wrote something.

If anything is ambiguous, stop and ask rather than picking.
