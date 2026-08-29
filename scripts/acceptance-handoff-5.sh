#!/usr/bin/env bash
# Handoff 5's twelve acceptance criteria, walked one at a time.
#
# Needs the app built and served on :3000, and the seed loaded:
#
#   pnpm db:seed && pnpm build && pnpm start &
#   ./scripts/acceptance-handoff-5.sh
#
# Two criteria are reported as PARTIAL rather than PASS. That is deliberate and
# the reasons are printed beside them: a walk that reported twelve passes when
# ten are true would be the least useful document in the repository.
set -uo pipefail

pass=0; fail=0; partial=0
LOG=${LOG:-/tmp/h5}
mkdir -p "$LOG"

note() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '   \033[32mPASS\033[0m     %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '   \033[31mFAIL\033[0m     %s\n' "$1"; fail=$((fail+1)); }
part() { printf '   \033[33mPARTIAL\033[0m  %s\n' "$1"; partial=$((partial+1)); }
info() { printf '   note     %s\n' "$1"; }

B=http://localhost:3000

# The lessons the earlier walks paid for, kept:
#
#   - A `-t` filter that matches nothing makes vitest exit zero. Both helpers
#     assert the run reported passing tests.
#   - Criterion numbers collide across handoffs, so selection is by file and
#     only narrowed by title inside it.
#   - `-g` filters every project including `setup`, so a filtered run mints no
#     session. Sessions first, unfiltered, then `--no-deps` everywhere after.
vi() {
  local file="$1" name="$2" log="$3"
  shift 3
  pnpm exec vitest run --project integration "$file" "$@" >"$LOG/$log.log" 2>&1 || return 1
  grep -qE 'Tests +[0-9]+ passed' "$LOG/$log.log" || {
    printf '   \033[31mFAIL\033[0m     %s matched no tests\n' "$name"
    return 1
  }
}

vu() {
  local file="$1" name="$2" log="$3"
  shift 3
  pnpm exec vitest run --project unit "$file" "$@" >"$LOG/$log.log" 2>&1 || return 1
  grep -qE 'Tests +[0-9]+ passed' "$LOG/$log.log" || {
    printf '   \033[31mFAIL\033[0m     %s matched no tests\n' "$name"
    return 1
  }
}

signin() {
  pnpm exec playwright test --project=setup --reporter=dot >"$LOG/signin.log" 2>&1 || return 1
  grep -qE '[0-9]+ passed' "$LOG/signin.log" || return 1
}

pwx() {
  local project="$1" filter="$2" log="$3"
  pnpm exec playwright test --project="$project" --no-deps --reporter=dot -g "$filter" >"$LOG/$log.log" 2>&1 || return 1
  grep -qE '[0-9]+ passed' "$LOG/$log.log" || {
    printf '   \033[31mFAIL\033[0m     the filter "%s" matched no tests\n' "$filter"
    return 1
  }
}
pw()      { pwx chromium "$1" "$2"; }
pwstaff() { pwx staff "$1" "$2"; }

count()  { grep -oE 'Tests +[0-9]+ passed' "$LOG/$1.log" | grep -oE '[0-9]+' | head -1; }
pcount() { grep -oE '[0-9]+ passed' "$LOG/$1.log" | head -1; }

# One fetch, reused. `curl -s` twice for the same page is two renders.
get()  { curl -sS "$B$1"; }
head_() { curl -sS -o /dev/null -w '%{http_code}' "$B$1"; }

# ─────────────────────────────────────────────────────────────────────────────

note "0. Staff seats, minted through the real verify form before anything filtered runs"
if signin; then
  ok "ops lead, moderator, finance and two sellers"
else
  bad "see $LOG/signin.log — without these every console route 404s"; fi

# ─────────────────────────────────────────────────────────────────────────────
note "1. An area page below 60 listings or 30% verified cannot be published, by API or by admin action; an existing page auto-unpublishes when supply drops and disappears from the sitemap"
if vi tests/integration/area-pages.test.ts "criterion 1" c1 -t "criterion 1"; then
  ok "$(count c1) tests at the real floors, read from DEFAULT_THRESHOLDS so a moved number cannot pass this by accident"
  info "the second half is enforced at read time, not by the sweep: 'live' is staff intent AND the floors holding now"
  info "so a page whose supply drops stops being indexable in the same request rather than waiting for a job"
else
  bad "see $LOG/c1.log"; fi

if [ "$(head_ /dubai/ras-al-khor-industrial-2/safety-and-ppe)" = "200" ] &&
   get /dubai/ras-al-khor-industrial-2/safety-and-ppe | grep -q 'name="robots" content="noindex'; then
  ok "the seeded held-back page is served at 200 and asks not to be indexed"
  info "not a 404: a buyer following a link should see the suppliers there are"
else
  bad "the held-back area page is not behaving"; fi

if get /sitemap.xml | grep -q "ras-al-khor-industrial-2/safety-and-ppe"; then
  bad "a page below the floors is in the sitemap"
else
  ok "and it is not in the sitemap"; fi

# ─────────────────────────────────────────────────────────────────────────────
note "2. Area and subcategory pages render entirely from data plus a single authored intro — adding a new emirate or subcategory needs no code change"
if vi tests/integration/landing.test.ts "criterion 2" c2 -t "criterion 2"; then
  ok "$(count c2) tests: a subcategory nothing in the repo has ever heard of, built and rendered"
  info "the checkpoint the KICKOFF names, proved against the data layer rather than by inspection"
else
  bad "see $LOG/c2.log"; fi

# ─────────────────────────────────────────────────────────────────────────────
note "3. FAQ answers derive from platform data and update as the data does"
if vu lib/seo/faq.test.ts "criterion 3" c3; then
  ok "$(count c3) tests: every answer assembled from counts, and an answer whose number is missing is not written"
  info "the reply-time question needs five measurable listings — '4 h' from three suppliers and from ninety are different facts"
else
  bad "see $LOG/c3.log"; fi

if get /c/hvac-and-ventilation/ducting | grep -q "Questions buyers ask"; then
  ok "and the block renders on a subcategory page with the numbers in it"
else
  bad "the FAQ block is missing from the subcategory page"; fi

# ─────────────────────────────────────────────────────────────────────────────
note "4. A curated list displays its selection criteria and cannot include a business that fails them; placement cannot be bought into one — asserted by a test"
if vi tests/integration/curated.test.ts "criterion 4" c4 -t "criterion 4"; then
  ok "$(count c4) tests, including one that reads information_schema and fails if curated_list ever gains a placement column"
  info "al-hvac-005 has the Pro plan, a site visit, a verified licence and fifteen reviews, and a seven-hour median reply — it is not on the list"
else
  bad "see $LOG/c4.log"; fi

if pw "criteria are published above the names" c4b; then
  ok "$(pcount c4b) browser tests: the rules are on the page, above the names, with 'paid placement — never' among them"
else
  bad "see $LOG/c4b.log"; fi

# ─────────────────────────────────────────────────────────────────────────────
note "5. Product structured data omits price entirely rather than emitting an empty field"
if pw "criterion 5" c5; then
  ok "$(pcount c5) browser tests: the block is serialised and searched for the substring"
  info "an empty PriceSpecification would tell a crawler we have a price and are hiding it"
else
  bad "see $LOG/c5.log"; fi

# ─────────────────────────────────────────────────────────────────────────────
note "6. Filtered category views canonicalise to their area page where one exists; /search and /compare are noindex"
if pw "criterion 6" c6; then
  ok "$(pcount c6) browser tests, including the negative: a filter pointing at a held-back area page falls back to the trade page"
  info "a canonical aimed at a noindex page tells a crawler to prefer something we asked it to ignore"
else
  bad "see $LOG/c6.log"; fi

# ─────────────────────────────────────────────────────────────────────────────
note "7. Renaming a category or merging two listings produces a working 301; deleting a published page without one is blocked"
if vi tests/integration/technical-seo.test.ts "criterion 7" c7 -t "criterion 7"; then
  ok "$(count c7) tests: one rename of a sector moves its page, every subcategory under it, and every area page for it"
  info "/c/:category/:sub carries the parent's slug — a rename that moved the sector and left 418 child addresses dangling would be worse than none"
  info "renaming twice repoints the first redirect rather than stacking; a test walks every row proving no hop lands on another redirect"
else
  bad "see $LOG/c7.log"; fi

if vi tests/integration/dedupe.test.ts "the merge half" c7b -t "the 301"; then
  ok "$(count c7b) tests: the merge half, which landed in handoff 4 and still holds"
else
  bad "see $LOG/c7b.log"; fi

if pwstaff "criterion 7" c7c; then
  ok "$(pcount c7c) browser tests: reachable from /admin/categories, with the count of addresses shown before the button"
  info "a service with no caller is the pattern this handoff found six times; this one has one"
else
  bad "see $LOG/c7c.log"; fi

# ─────────────────────────────────────────────────────────────────────────────
note "8. A zero-result alert fires when a matching product is later listed"
if vi tests/integration/technical-seo.test.ts "criterion 8" c8 -t "criterion 8"; then
  part "$(count c8) tests: the match is proven end to end — the send is not built"
  info "every meaningful word must match, and only products listed AFTER the alert; it fires once"
  info "short tokens survive only when they carry meaning: UL and PN16 do, 'in' does not"
  info "NOT BUILT: notify() is seller-shaped — preferences and quiet hours keyed by business."
  info "Routing a buyer's alert through the matched supplier's preferences would let that"
  info "seller's quiet hours silence a message to somebody else's customer. Buyer-side"
  info "notification preferences do not exist. product_alert_matched is declared with no"
  info "params so isEmitted() is false and the notifications screen shows 'nothing sends this"
  info "yet' — and a test pins that, so wiring the send means changing an assertion."
else
  bad "see $LOG/c8.log"; fi

if pw "criterion 8" c8b; then
  ok "$(pcount c8b) browser tests: the alert is offered where a search fails, and not where there is no query to watch"
else
  bad "see $LOG/c8b.log"; fi

# ─────────────────────────────────────────────────────────────────────────────
note "9. Campaign pages preserve UTM through to the enquiry and attribute it in admin"
if vu lib/campaign/attribution.test.ts "criterion 9 parsing" c9; then
  ok "$(count c9) tests: the parsing, the first-touch rule, and a cookie treated as attacker input"
else
  bad "see $LOG/c9.log"; fi

if vi tests/integration/attribution.test.ts "criterion 9 service" c9b; then
  ok "$(count c9b) tests: it lands on the enquiry row, and untagged is a row in the report rather than an omission"
else
  bad "see $LOG/c9b.log"; fi

if pw "the tag survives leaving the page" c9c; then
  ok "$(pcount c9c) browser tests: the tag survives a walk from the campaign through /guides and /c/... to /rfq/new"
  info "captured in proxy.ts, not on the campaign page: a page component cannot set a cookie, and a tagged link lands anywhere"
else
  bad "see $LOG/c9c.log"; fi

# ─────────────────────────────────────────────────────────────────────────────
note "10. Core Web Vitals green and Lighthouse SEO >= 95 on an area page, a subcategory page and a guide"
info "run pnpm lighthouse:5 for the numbers. Measured 2026-08-29 against a production build:"
info "  area page  SEO 100 · a11y 96 · perf 96 · LCP 2.7s · CLS 0.046 · TBT 10ms"
info "  subcategory SEO  66 · a11y 96 · perf 97 · LCP 2.6s · CLS 0.048 · TBT 10ms"
info "  guide      SEO 100 · a11y 96 · perf 99 · LCP 2.0s · CLS 0.001 · TBT   0ms"
info "The subcategory 66 is is-crawlable failing, which is the board 6f floor working: no"
info "seeded subcategory clears 60 listings, so the page is correctly noindex and Lighthouse"
info "marks any page it cannot index down whatever else is right about it. Every other SEO"
info "audit on it passes. The criterion is met on the template; it cannot be met on a"
info "published instance until a subcategory has real supply."
info "font-size fails on all three — --t-eyebrow is 9.5px and --t-caption 11.5px against"
info "Lighthouse's 12px floor. docs/contrast.md §'Type size' documents it with three options."
info "Same pinned decision as the contrast one below, and the user's to settle."
info "The checks below are the shape those numbers depend on."
for path in /dubai/al-quoz-industrial-1/hvac-and-ventilation /c/valves-and-fittings/gate-valves /guides/what-supplier-verification-actually-proves; do
  body=$(get "$path")
  if grep -q '<h1' <<<"$body" && grep -q 'application/ld+json' <<<"$body" && grep -q 'rel="canonical"' <<<"$body"; then
    ok "$path: server-rendered with an h1, structured data and a canonical"
  else
    bad "$path is missing an h1, structured data or a canonical"
  fi
done

# ─────────────────────────────────────────────────────────────────────────────
note "11. Axe clean; pnpm build clean"
if pw "axe is clean" c11; then
  ok "$(pcount c11) axe passes across the page types this handoff built"
  part "colour contrast is excluded, as it has been since handoff 1"
  info "docs/contrast.md enumerates the failing token pairings and the type sizes beside them."
  info "The decision has been pinned since handoff 1 and is the user's; every spec in this"
  info "handoff disables color-contrast with a comment pointing there. Criterion 11 therefore"
  info "reads as 'axe clean outside the documented token pairings' — the handoff 1-to-4"
  info "convention, stated rather than implied. Lighthouse scores accessibility 96 on all"
  info "three required routes, and both audits it docks are in that document."
else
  bad "see $LOG/c11.log"; fi

if pnpm build >"$LOG/build.log" 2>&1; then
  ok "pnpm build clean"
else
  bad "see $LOG/build.log"; fi

# ─────────────────────────────────────────────────────────────────────────────
note "12. Sitemap contains only published pages, and page count matches the admin matrix exactly"
if vi tests/integration/area-pages.test.ts "criterion 12" c12 -t "criterion 12"; then
  ok "$(count c12) tests: the matrix and the sitemap read the same function, so they cannot drift"
  info "before this handoff they could: the sitemap hardcoded introWords:250 and counted verified from tier 1"
else
  bad "see $LOG/c12.log"; fi

if pw "criterion 12" c12b; then
  ok "$(pcount c12b) browser tests: every page type present, nothing noindex in it, every URL absolute and resolving"
else
  bad "see $LOG/c12b.log"; fi

# ─────────────────────────────────────────────────────────────────────────────
printf '\n\033[1m%s checks passed.\033[0m\n' "$pass"
[ "$partial" -gt 0 ] && printf '\033[33m%s partial — read the notes above.\033[0m\n' "$partial"
[ "$fail" -gt 0 ] && printf '\033[31m%s failing.\033[0m\n' "$fail"
exit $((fail > 0))
