# Handoff 0 — Foundation

**Goal:** a repo where every later feature is assembly, not invention. Nothing user-facing
ships in this handoff. When it is done, a developer can build any screen in the canvas
without inventing a token, a component, a route name or a table.

**Reference files, in the repo, read before starting:**

- `docs/design-system.md` — tokens, components, states, voice. The authority on how anything
  looks and behaves.
- `docs/routes.md` — the full route table for all three surfaces.
- `docs/data-model.md` — entities and the rules that live on them.
- `CLAUDE.md` — the non-negotiables and the vocabulary.

The screen canvas is the authority on *where things sit and why*. This handoff builds only
what every screen shares.

---

## Scope — five deliverables

### 1. Repo scaffold

```
app/
  (public)/            # buyer-facing, roomy density
  (dashboard)/         # seller, comfortable density
  (admin)/             # staff, compact density
  dev/gallery/         # component gallery — the acceptance surface for this handoff
components/
  primitives/          # tier 1 — 18 components
  structure/           # tier 2 — 17 components
  display/             # tier 3 — 15 components (stubs only in this handoff)
  domain/              # tier 4 — 14 components (not in this handoff)
lib/
  db/                  # prisma client, seed
  auth/                # session, roles, permission checks
  i18n/                # t(), string catalogue
  audit/               # writeAudit() — used by every staff mutation
  format/              # currency, dates, phone, TRN masking, sizes
docs/
```

Three route groups, three density modes. Density is set once on the shell via
`data-density="roomy|comfortable|compact"` and inherited — never passed as a size prop to
individual components.

### 2. Tokens

Paste the CSS variable block from design-system §09.1 into `app/globals.css` under `:root`.
Map them into `tailwind.config.ts` so `bg-paper`, `text-muted`, `border-line`, `rounded-card`
resolve to the variables. **No raw hex anywhere in the codebase after this handoff** — add a
lint rule that fails on `#[0-9a-f]{3,6}` outside `globals.css`.

Density tokens as a data-attribute block:

```css
[data-density="roomy"]       { --row-h: auto; --gutter: 18px; --section-pad: 48px; }
[data-density="comfortable"] { --row-h: 46px; --gutter: 14px; --section-pad: 24px; }
[data-density="compact"]     { --row-h: 38px; --gutter: 10px; --section-pad: 20px; }
```

Fonts: Geist, Instrument Serif, JetBrains Mono, self-hosted with `font-display: swap` and
`font-variant-numeric: tabular-nums` on the mono face.

### 3. Components — tiers 1 and 2

**Tier 1, primitives (18).** Button (5 variants × 4 sizes × default/hover/focus/disabled/
loading), IconButton, SplitButton, SegmentedControl, Input, Textarea with counter, Select,
MultiSelect, SearchField, Checkbox (incl. indeterminate), Radio, Toggle, RangeSlider,
Stepper, TimePair, FileDrop (idle/uploading/done/error), Label, FieldError.

**Tier 2, structure (17).** DataTable, TableToolbar, SelectionBar, Pagination,
KeyValuePanel, Card, Panel, Tabs, Breadcrumb, PublicNav, AppSidebar, PageHeader, StepHeader,
FilterRail, BuilderChrome, Drawer, Modal.

Variants are props on one component, never separate components. `<Button variant="danger">`,
not `<DangerButton>`.

**DataTable is the one to get right** — two surfaces live in it. It must support: mono
uppercase column heads on `--paper-sunk`, hairline row dividers, no vertical rules, no zebra
striping, right-aligned tabular numbers, row tint carrying meaning (`selected` / `attention`
/ `blocked` and nothing decorative), one visible row action with the rest behind a three-dot
menu, sortable heads with a visible arrow, indeterminate select-all, a selection bar that
replaces the toolbar, and pagination above 50 rows. Never infinite scroll on a work surface.

### 4. Shells

`PublicShell` — 68px nav with the search field in the bar, breadcrumb, results toolbar,
footer. `DashboardShell` — 236px grouped sidebar with badge counts, 58px page header,
optional tab row. `AdminShell` — same sidebar component, admin mark, six groups, compact.
`BuilderChrome` — ink bar, no sidebar, for any full-screen editing surface.

Sidebar is one component driven by a nav config, not two copies.

### 5. Plumbing

**Auth and roles.** Mobile-first identity: OTP by SMS is a first-class login path, not a
fallback. Roles: `buyer`, `seller_owner`, `seller_manager`, `seller_sales`, `seller_finance`,
`staff_moderator`, `staff_field`, `staff_finance`, `staff_ops_lead`. Permission checks are a
server-side function per capability, keyed off the matrix in design-system §07 — not
scattered `if (role === …)` in components.

**Audit.** `writeAudit({ actor, action, subject, reason, before, after })`. Reason is
required. Every staff mutation goes through it.

**i18n.** `t()` with a flat English catalogue. Category names and area names are translatable
records in the database, not code strings.

**Formatters.** `formatAED` (AED 15,624 / 15,624.00 in quotes), `formatCount` (41,204 —
never 41.2k), `formatDate` (14 Aug 2026), `formatRelative` (4 min ago → 2 h → 2 d 4 h → the
date), `formatTime` (24-hour, en dash ranges), `formatPhone` (04 883 4120 / +971 50 641 2288),
`maskPhone` (04 88• ••••), `maskTRN` (first 3, last 4), `formatSize` (DN100 · 4 inch, metric
first). Write these with tests before any screen uses them — inconsistent number formatting
is the fastest way to make a directory look unreliable.

**Reveal counting.** `maskPhone` pairs with a `contact_reveal` event write. Masking is not a
growth trick; it is how the platform proves it delivered the enquiry.

---

## Data model

Full detail in `docs/data-model.md`. The shape that matters:

`Business` — trade name, display name, slug, licence number, licensing authority, TRN,
established year, team size, languages, verification_tier (staff-only), plan, primary
category, additional categories.
`Location` — belongs to Business. Type, emirate, area, address, pin lat/lng, phone,
whatsapp, hours, ramadan_hours, published flag.
`Category` — self-referencing tree, slug, two-letter code, synonyms (incl. Arabic),
default spec template, visibility flags, publish thresholds.
`SpecTemplate` / `SpecField` — platform-owned, versioned. Seller clones are `SellerTemplate`
rows mapped back to the platform field, so cross-seller comparison survives a rename.
`Product` — name, sku, category, availability enum (`in_stock` | `made_to_order` |
`indent` | `out_of_stock`), stock qty, lead time, spec values, media. **No price column.**
`Enquiry` — buyer, requirement text, lines, delivery area, needed-by date, terms wanted,
attachments, recipients (1..n businesses), closes_at.
`Quote` — belongs to Enquiry + Business. Revision number, validity days, note, status
(`draft` | `sent` | `read` | `accepted` | `lost` | `expired`).
`QuoteLine` — **the only place a price exists.** Qty, unit price, lead time, sku match or
manual flag.
`Review` — requires a confirmed enquiry or accepted quote. Four dimensions plus overall.
One per enquiry, editable 14 days, one seller reply, never seller-deletable.
`Subscription` / `Invoice` / `PlacementSlot` — subscription and sponsored placement only.
No commission, no payout, no order.
`SupplierReport` — the trust queue. Outcomes: `seller_corrected` | `upheld` | `no_action`.
`AuditEvent` — actor, action, subject, reason (required), before/after.

**Enum values are the vocabulary.** No `order_status`, no `payment_status`, no `fee`.

---

## Acceptance criteria

Not "it looks right" — these are checkable:

1. `/dev/gallery` renders every tier 1 and tier 2 component in every documented state, and
   a reviewer can diff it against design-system §02–§05 without finding a missing state.
2. The three shells render at all three densities from the same components.
3. `grep -rE '#[0-9a-f]{3,6}' --include=*.tsx` returns nothing.
4. `grep -rE '>[A-Z][a-z]+ [a-z]+' --include=*.tsx` finds no user-visible string outside `t()`.
5. Every formatter has a test, including the masking ones.
6. A `staff_moderator` calling a tier-change mutation is rejected server-side, and the
   rejection is covered by a test.
7. Any staff mutation without a reason throws.
8. Axe passes on the gallery: contrast, focus visibility, table headers, live regions.
9. Prisma schema contains no `price` on Product, no `order` table, and no `payout` field.
10. `pnpm build` clean under TypeScript strict.

---

## Explicitly out of scope

No screens. No public pages, no dashboard pages, no admin pages beyond the gallery. No
domain components (tier 4) — those arrive with the slice that needs them. No search
implementation, no map tiles, no email or WhatsApp sending, no payment integration ever.

---

## Why this order

The enquiry engine in handoff 2 is the spine of the product, and it touches DataTable,
FileDrop, the quote-line editor, the formatters, the audit layer and the permission matrix.
Building it on invented primitives means rebuilding it. Everything in this handoff exists
because at least three later screens need it identically.
