# Kickoff prompt — Handoff 4

Paste below the line into Claude Code, in the repo produced by handoffs 0–3.

---

Read `handoff-4-superadmin/README.md` in full, plus `CLAUDE.md`, `docs/design-system.md` §07
(superadmin column) and `docs/routes.md` admin block from the existing repo.

You are building **handoff 4: the superadmin console** — the machinery that keeps a
41,000-listing marketplace honest and growing. Six jobs: get listings in, keep the data
comparable, build what sellers fill, grow and keep accounts, take the money, protect the trust.

Compact density throughout, no serif anywhere. Every screen answers "what is behind and who is
it blocking"; queues show age and SLA breach before volume. Board `[4a]` is the console in one
screen — every number on it links into the queue that fixes it.

Build in this order, stopping for review at each checkpoint:

**1. Moderation and taxonomy.** `[4b]` queue, `[4c]` submission review including the
conflicting-claim resolution, `[4d]` taxonomy with publish thresholds and synonyms, `[4e]`
versioned spec library with the grace-period path.
**Checkpoint: resolve a conflicting claim four different ways.**

**2. Ingestion.** `[12a]` importer — stage, never auto-publish, rejections by countable
reason. `[12b]` dedupe with the confidence bands; the 60–90% band needs a human because
merging two separate companies destroys reviews.
**Checkpoint: import 8,000 records without publishing any, then bulk-merge above 90%.**

**3. Trust.** `[4h]` supplier reports (outcomes: seller_corrected / upheld / no_action —
never payment disputes), `[4i]` staff, roles and audit log, `[12h]` field visits, PDPL, API
keys, staff security.
**Checkpoint: prove a moderator cannot change a verification tier.**

**4. Accounts and CRM.** `[4f]` account health, `[12d]` the self-building call list, `[12f]`
support desk with read-only 30-minute view-as that writes an audit row.

**5. Commercials.** `[4g]` revenue and MRR movement, `[12e]` entitlements as data, dunning
D0/D3/D7/D14, VAT export. No commission, no payouts, no GMV.

**6. Storefront builder and content ops.** `[5a]`–`[5e]`, `[5g]`, `[5h]` — a superadmin tool,
not a client one. `[6f]` page matrix with the 60-listing / 30%-verified thresholds enforced in
code. `[12g]` notification templates, localisation, homepage curation, redirects.

**7. Acceptance pass.** Walk the twelve criteria and show me each.

Three rules that make this console trustworthy:
every state change writes an audit row with a written reason · nothing publishes itself ·
the console cannot move buyer money, because there is none to move.

If anything is ambiguous, stop and ask rather than picking.
