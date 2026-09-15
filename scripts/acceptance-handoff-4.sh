#!/usr/bin/env bash
# The twelve acceptance criteria from handoff 4's README, plus the twelve the
# storefront spec carries for step 6.
#
# Needs the app built and served on :3000, and the seed loaded.
set -uo pipefail

pass=0; fail=0
LOG=${LOG:-/tmp/h4}
mkdir -p "$LOG"

note() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '   \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '   \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
info() { printf '   note  %s\n' "$1"; }

B=http://localhost:3000

# The three lessons handoff 3's walk paid for, kept:
#
#   - A `-t` filter that matches nothing makes vitest exit zero. Both helpers
#     assert the run reported passing tests.
#   - Criterion numbers collide across handoffs, so selection is by file and
#     only narrowed by title inside it.
#   - `-g` filters every project including `setup`, so a filtered run mints no
#     session and the specs go out with whatever is on disk. Sessions first,
#     unfiltered, then `--no-deps` everywhere after.
vi() {
  local file="$1" name="$2" log="$3"
  shift 3
  pnpm exec vitest run --project integration "$file" "$@" >"$LOG/$log.log" 2>&1 || return 1
  grep -qE 'Tests +[0-9]+ passed' "$LOG/$log.log" || {
    printf '   \033[31mFAIL\033[0m  %s matched no tests\n' "$name"
    return 1
  }
}

vu() {
  local file="$1" name="$2" log="$3"
  shift 3
  pnpm exec vitest run --project unit "$file" "$@" >"$LOG/$log.log" 2>&1 || return 1
  grep -qE 'Tests +[0-9]+ passed' "$LOG/$log.log" || {
    printf '   \033[31mFAIL\033[0m  %s matched no tests\n' "$name"
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
    printf '   \033[31mFAIL\033[0m  the filter "%s" matched no tests\n' "$filter"
    return 1
  }
}
pwstaff()   { pwx staff "$1" "$2"; }
pwmod()     { pwx staff-moderator "$1" "$2"; }
pwfinance() { pwx staff-finance "$1" "$2"; }
pw()        { pwx chromium "$1" "$2"; }

count()  { grep -oE 'Tests +[0-9]+ passed' "$LOG/$1.log" | grep -oE '[0-9]+' | head -1; }
pcount() { grep -oE '[0-9]+ passed' "$LOG/$1.log" | head -1; }

# ─────────────────────────────────────────────────────────────────────────────

note "0. Four staff seats, signed in through the real verify form"
if signin; then
  ok "ops lead, moderator, finance and two sellers, minted before anything filtered runs"
  info "finance exists because §07 puts revenue.read there and gives ops lead a dash"
else
  bad "see $LOG/signin.log — without these every console route 404s"; fi

note "1. 8,000 records stage without publishing; rejections countable by ground"
if vi tests/integration/licence-ingest.test.ts "criterion 1" c1 -t "eight thousand"; then
  ok "$(count c1) tests: nothing published on import, and every rejection carries a ground"
  info "8,000 is the README's number; the fixture generates it rather than shipping it"
else
  bad "see $LOG/c1.log"; fi

note "2. Dedupe bands; a merge is reversible for 30 days, audited, and 301s"
if vi tests/integration/dedupe.test.ts "the whole merge" c2 -t "merging moves everything"; then
  ok "$(count c2) tests: merged, audited, unmerged, reviews came back, old path 301s"
else
  bad "see $LOG/c2.log"; fi
if vi tests/integration/dedupe.test.ts "the candidate list" c2b -t "candidate list"; then
  ok "$(count c2b) tests on the banding, including what the 500 cap drops"
else
  bad "see $LOG/c2b.log"; fi

note "3. A conflicting claim resolves four ways and notifies both parties"
if vi tests/integration/claim-conflict.test.ts "criterion 3" c3 -t "four ways"; then
  ok "$(count c3) tests, one per resolution — the checkpoint's own demand"
else
  bad "see $LOG/c3.log"; fi

note "4. A new required field does not invalidate existing products"
if vu lib/metrics/spec-completeness.test.ts "the affected count" c4; then
  ok "$(count c4) unit tests on the pure affected-count function"
else
  bad "see $LOG/c4.log"; fi
if vi tests/integration/spec-library.test.ts "criterion 4" c4b -t "grace period"; then
  ok "$(count c4b) tests: the grace path, and versioning that bumps rather than clones"
  info "cloning would have given every field a new id and orphaned every product's specValues"
else
  bad "see $LOG/c4b.log"; fi

note "5. Weights reorder live results; a boost needs a reason and an expiry"
if vi tests/integration/search-ranking.test.ts "criterion 5" c5 -t "criterion 5"; then
  ok "$(count c5) tests: the real search reorders, and a boost lifts then expires"
  info "board 12c was never in the roadmap's step list — this walk is what found that"
else
  bad "see $LOG/c5.log"; fi

note "6. A page below the floor cannot publish, and says which half it failed"
if vu lib/publish-threshold.test.ts "the floor" c6; then
  ok "$(count c6) unit tests on the pure decision"
else
  bad "see $LOG/c6.log"; fi
if vi tests/integration/page-matrix.test.ts "the gate that used to pass vacuously" c6b -t "vacuously"; then
  ok "$(count c6b) tests: the intro word count, which had nowhere to live until step 7"
else
  bad "see $LOG/c6b.log"; fi

note "7. The call list generates from signals, with no way to type into it"
if vi tests/integration/accounts-crm.test.ts "criterion 7" c7 -t "call list builds itself"; then
  ok "$(count c7) tests on generation from missed enquiries and zero-result searches"
else
  bad "see $LOG/c7.log"; fi
typed=$(grep -rnE "callOutcome|prospect" "app/(admin)/admin/crm" --include='*.tsx' 2>/dev/null | grep -cE "create|insert|add" || true)
if [ "${typed:-0}" = "0" ]; then
  ok "no control on the CRM screen inserts a prospect — the absence is the feature"
else
  bad "$typed call sites on the CRM screen look like an insert path"; fi

note "8. View-as is read-only, expires at 30 minutes, and names the ticket"
if vi tests/integration/accounts-crm.test.ts "criterion 8" c8 -t "view-as session"; then
  ok "$(count c8) tests: the audit row, the clock-advanced cap, and a refused mutation"
else
  bad "see $LOG/c8.log"; fi

note "9. A moderator cannot change a tier, issue a credit, or suspend"
if vi tests/integration/roles.test.ts "criterion 9" c9 -t "criterion 9"; then
  ok "$(count c9) tests calling each service as a moderator — written first, in step 0"
else
  bad "see $LOG/c9.log"; fi
if pwmod "moderator" c9b; then
  ok "$(pcount c9b) browser tests: the console does not offer the control either"
  info "both halves are needed — a hidden button is a UI opinion and a server action is a URL"
else
  bad "see $LOG/c9b.log"; fi

note "10. Dunning runs D0/D3/D7/D14 and never deletes a listing or removes a badge"
if vu lib/billing/dunning.test.ts "the sequence" c10; then
  ok "$(count c10) unit tests, including one that enumerates every action the union can produce"
else
  bad "see $LOG/c10.log"; fi
if vi tests/integration/commercials.test.ts "criterion 10" c10b -t "dunning never"; then
  ok "$(count c10b) tests: a full census of the account before and after the sequence"
else
  bad "see $LOG/c10b.log"; fi
if pwfinance "criterion 10" c10c; then
  ok "$(pcount c10c) browser tests: no control on the screen can suspend, unpublish or unverify"
else
  bad "see $LOG/c10c.log"; fi

note "11. Every console mutation writes an audit row, and no reason throws"
if pnpm check:audit >"$LOG/c11.log" 2>&1; then
  ok "$(grep -oE '[0-9]+ modules' "$LOG/c11.log" | head -1) the console can reach mutate, and every one audits"
  info "$(grep -oE '[0-9]+ exempt' "$LOG/c11.log" | head -1), each with a written reason in the script"
  info "per module, not per call site — a new function in a service that already audits would slip past"
else
  bad "see $LOG/c11.log"; fi
if vi tests/integration/staff-refusals.test.ts "the audit contract" c11b -t "fail open"; then
  ok "$(count c11b) tests over the capability table, including that a blank reason throws"
else
  bad "see $LOG/c11b.log"; fi

note "12. Axe clean at compact density, and the build is clean"
if pnpm exec playwright test --project=staff --project=staff-moderator --project=staff-finance --no-deps --reporter=dot -g "axe" >"$LOG/c12a.log" 2>&1; then
  ok "$(pcount c12a) axe checks across the console, colour-contrast excepted"
  info "the exception is the pinned §09.2 pairing set — docs/contrast.md, unresolved since handoff 1"
  info "criterion 12 reads as 'clean outside the documented pairings' until that is settled"
else
  bad "see $LOG/c12a.log"; fi
if pnpm exec tsc --noEmit >"$LOG/c12b.log" 2>&1 && pnpm build >>"$LOG/c12b.log" 2>&1; then
  ok "tsc --noEmit clean, next build clean"
else
  bad "see $LOG/c12b.log"; fi

# ── Step 6, storefront templates ─────────────────────────────────────────────
#
# Nothing left to accept. The domain half (S8) became subdomains in `proxy.ts`
# on 9 Sep 2026 and its tests went with the DNS code; the template half —
# builder, theme presets, section library, template pages, specimens — was cut
# with boards 5a, 5b and 5c on 15 Sep 2026. What survives of the storefront is
# accepted by `tests/e2e/storefront.spec.ts`, including criterion 8.

note "S. Step 6 was cut — the storefront renders one fixed overview"
info "boards 5a, 5b, 5c removed 15 Sep 2026; see docs/build-plan.md Phase 8"

# ─────────────────────────────────────────────────────────────────────────────
printf '\n\033[1m%s checks passed.\033[0m\n' "$pass"
[ "$fail" -gt 0 ] && printf '\033[31m%s failing.\033[0m\n' "$fail"
exit $((fail > 0))
