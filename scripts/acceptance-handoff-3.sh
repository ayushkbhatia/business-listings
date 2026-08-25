#!/usr/bin/env bash
# The twelve acceptance criteria from handoffs/handoff-3-seller-dashboard/README.md.
# Needs the app built and served on :3000, and the seed loaded.
set -uo pipefail

pass=0; fail=0
LOG=${LOG:-/tmp/h3}
mkdir -p "$LOG"

note() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '   \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '   \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
info() { printf '   note  %s\n' "$1"; }

B=http://localhost:3000

# One run per criterion, and each helper fails when the filter matched nothing.
#
# Three lessons are built in, each paid for once:
#
#   - Handoff 2's walk passed a criterion whose `-t` matched no tests at all;
#     vitest skips, exits zero, and a green line means nothing. Both helpers
#     assert the run reported passing tests.
#   - It also ran chromium and seller only, and was green while four mobile
#     specs were red — including a wizard whose Continue button could not be
#     pressed on a phone.
#   - Criterion numbers collide across handoffs: `criterion 1` exists in
#     handoff 2's enquiry tests and handoff 3's onboarding tests. So these
#     select by **file**, and only narrow by title inside it.
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
  pnpm exec vitest run --project unit "$file" >"$LOG/$log.log" 2>&1 || return 1
  grep -qE 'Tests +[0-9]+ passed' "$LOG/$log.log" || {
    printf '   \033[31mFAIL\033[0m  %s matched no tests\n' "$name"
    return 1
  }
}

pwx() {
  local project="$1" filter="$2" log="$3"
  pnpm exec playwright test --project="$project" --reporter=dot -g "$filter" >"$LOG/$log.log" 2>&1 || return 1
  grep -qE '[0-9]+ passed' "$LOG/$log.log" || {
    printf '   \033[31mFAIL\033[0m  the filter "%s" matched no tests\n' "$filter"
    return 1
  }
}
pw()  { pwx chromium "$1" "$2"; }
pws() { pwx seller "$1" "$2"; }
pwf() { pwx seller-free "$1" "$2"; }
pwm() { pwx mobile "$1" "$2"; }

count() { grep -oE 'Tests +[0-9]+ passed' "$LOG/$1.log" | grep -oE '[0-9]+' | head -1; }
pcount() { grep -oE '[0-9]+ passed' "$LOG/$1.log" | head -1; }

# ─────────────────────────────────────────────────────────────────────────────

note "1. A supplier finds an unclaimed record, verifies, and reaches a dashboard with no staff"
if vi tests/integration/onboarding.test.ts "criterion 1" c1 -t "criterion 1"; then
  ok "$(count c1) tests: found by trade name, by licence number with and without its hyphen, and by the phone on a branch"
else
  bad "see $LOG/c1.log"; fi
if pws "board 2a|board 2b" c1b; then
  ok "$(pcount c1b) browser tests across the claim and verify screens"
  info "the seat attaches on submission, so nothing waits for staff — ownership still does, which is handoff 4"
else
  bad "see $LOG/c1b.log"; fi

note "2. Claiming preserves existing reviews and historical enquiries"
if vi tests/integration/onboarding.test.ts "criterion 2" c2 -t "criterion 2"; then
  ok "$(count c2) tests: the whole before/after shape of the business is asserted, not two counts"
  info "a contested claim is taken rather than refused — the second claimant is often the real owner"
else
  bad "see $LOG/c2.log"; fi

note "3. The listing is live on Free before the plan screen"
if vi tests/integration/onboarding.test.ts "criterion 3" c3 -t "criterion 3"; then
  ok "$(count c3) tests: goLive publishes on Free at the locations step, and does not move the date on a second call"
else
  bad "see $LOG/c3.log"; fi
if pws "criterion 3 — the plan step is not a gate" c3b; then
  ok "$(pcount c3b) browser tests: the plan screen names the live address, and Stay on Free is a button"
else
  bad "see $LOG/c3b.log"; fi

note "4. Four setup tasks, independent, resumable, each returning with the strength updated"
if vi tests/integration/onboarding.test.ts "criterion 4" c4 -t "criterion 4"; then
  ok "$(count c4) tests: completion is counted from rows, so there is no flag to go stale"
  info "resumable needs no implementation — two reads with nothing between them give the same answer"
else
  bad "see $LOG/c4.log"; fi
if pws "board 8a" c4b; then
  ok "$(pcount c4b) browser tests on the hub, including what each task is worth in points"
else
  bad "see $LOG/c4b.log"; fi

note "5. A Free seller at their cap sees the missed enquiries, and every locked panel names its unlock"
if vi tests/integration/overview.test.ts "criterion 5" c5 -t "criterion 5"; then
  ok "$(count c5) tests: the seed sits exactly on the cap, and a skipped seller is recorded rather than skipped"
else
  bad "see $LOG/c5.log"; fi
if pwf "board 11a" c5b; then
  ok "$(pcount c5b) browser tests signed in as the Free seller, against real seeded misses"
  info "MissedEnquiry has no buyer relation, so the board has no column to leak a name from"
else
  bad "see $LOG/c5b.log"; fi

note "6. Cloning preserves the mapping; renaming warns and keeps it"
if vi tests/integration/template.test.ts "criterion 6" c6 -t "criterion 6"; then
  ok "$(count c6) tests: the label is a value and the platform field id is the key it hangs off"
  info "a clone stores an empty mapping, so an admin rename still reaches sellers who cloned before it"
else
  bad "see $LOG/c6.log"; fi
if pws "board 3h" c6b; then
  ok "$(pcount c6b) browser tests: our field beside theirs on every row, and the warning names the product count"
else
  bad "see $LOG/c6b.log"; fi

note "7. A CSV cannot import prices, and an import is reversible for 24 hours"
if vi tests/integration/import.test.ts "criterion 7" c7 -t "criterion 7"; then
  ok "$(count c7) tests: the service refuses before reading, and the undo deletes exactly what the run created"
else
  bad "see $LOG/c7.log"; fi
if vu tests/unit/import-columns.test.ts "the column fence" c7b; then
  ok "$(count c7b) unit tests on the fence, including every name a supplier's own export uses"
  info "\"Stock Value\" was exempt until whole-word matching landed — stockvalue contains kvalue"
else
  bad "see $LOG/c7b.log"; fi
if pws "board 11d" c7c; then
  ok "$(pcount c7c) browser tests on a real export: both price columns blocked, with no control to change them"
else
  bad "see $LOG/c7c.log"; fi

note "8. Only trade name, category and licence moderate; everything else publishes on save"
if vi tests/integration/listing.test.ts "criterion 8" c8 -t "criterion 8"; then
  ok "$(count c8) tests: both halves, and the database check that refuses a decision with no reason"
  info "the split is data in lib/listing/service.ts, and ModeratedField is an enum so a fourth field is a migration"
else
  bad "see $LOG/c8.log"; fi
if pws "board 3b" c8b; then
  ok "$(pcount c8b) browser tests: exactly three fields wait, and the instant half has no review step"
else
  bad "see $LOG/c8b.log"; fi

note "9. A sales seat is refused server-side from billing, plan and licence mutations"
if vi tests/integration/roles.test.ts "criterion 9" c9 -t "criterion 9"; then
  ok "$(count c9) tests calling each service as a sales actor — never a screen"
else
  bad "see $LOG/c9.log"; fi
if vu tests/unit/permission-matrix.test.ts "the matrix against §07" c9b; then
  ok "$(count c9b) tests transcribing docs/permissions.md row by row"
  info "nine rows were wrong while the matrix was inferred, five of them granting more than §07 allows"
else
  bad "see $LOG/c9b.log"; fi
if vu tests/unit/subject.test.ts "the three subject-dependent rows" c9c; then
  ok "$(count c9c) tests on the rows a role alone answers wrongly, each of which failed open"
else
  bad "see $LOG/c9c.log"; fi

note "10. Proration is correct, entitlements move with the plan, and cancel keeps what it says"
if vi tests/integration/billing.test.ts "criterion 10" c10 -t "criterion 10"; then
  ok "$(count c10) tests: the credit and charge are separate lines, and cancel drops at period end"
  info "products are hidden rather than deleted and the verification badge stays — it records what we checked"
else
  bad "see $LOG/c10.log"; fi
if vu tests/unit/proration.test.ts "the arithmetic" c10b; then
  ok "$(count c10b) unit tests in whole fils, both roundings in the seller's favour"
else
  bad "see $LOG/c10b.log"; fi
if pws "board 11f" c10c; then
  ok "$(pcount c10c) browser tests, including that no retention offer is made"
else
  bad "see $LOG/c10c.log"; fi

note "11. Response time and profile strength have no seller-writable path"
if vi tests/integration/overview.test.ts "criterion 11" c11 -t "criterion 11"; then
  ok "$(count c11) test: the column equals what the job computes, and nothing else can put a value there"
else
  bad "see $LOG/c11.log"; fi
if vu tests/unit/profile-strength.test.ts "the strength calculation" c11b; then
  ok "$(count c11b) unit tests on the pure function the job and the seed both call"
else
  bad "see $LOG/c11b.log"; fi
writable=$(grep -rn "profileStrength\|responseTimeMedianMs" app --include='*.ts' --include='*.tsx' | grep -vE "select:|profileStrength\b.*\?\?|// " | grep -E "data: *\{|formData" | wc -l | tr -d ' ')
if [ "$writable" = "0" ]; then
  ok "no route, action or form writes either column — the only writers are lib/metrics"
else
  bad "$writable call sites in app/ appear to write a derived column"; fi

note "12. Axe clean on the dashboard routes, build clean, and the gallery renders every component"
if pnpm exec playwright test --project=chromium --project=seller --project=seller-free --reporter=dot -g "axe" >"$LOG/c12a.log" 2>&1; then
  ok "$(pcount c12a) axe checks, colour-contrast excepted — see docs/contrast.md"
else
  bad "see $LOG/c12a.log"; fi
if pnpm exec tsc --noEmit >"$LOG/c12b.log" 2>&1 && pnpm build >>"$LOG/c12b.log" 2>&1; then
  ok "tsc --noEmit clean, next build clean"
else
  bad "see $LOG/c12b.log"; fi

curl -s "$B/dev/gallery" -o "$LOG/gallery.html"
# React puts a comment marker between two adjacent expressions, so the served
# markup reads `18<!-- -->/18` rather than `18/18`. Strip HTML comments before
# matching, or this greps for a string the page never contains.
# Head -4: the RSC payload embedded further down the page carries the same
# shape again, so matching the whole document finds each tier twice.
counts=$(sed 's/<!--[^>]*-->//g' "$LOG/gallery.html" | grep -oE '[0-9]+/(18|17|16|14)<' | tr -d '<' | head -4 | tr '\n' ' ')
if [ "$counts" = "18/18 17/17 16/16 14/14 " ]; then
  ok "gallery renders 18 + 17 + 16 + 14 = 65, every tier complete"
  info "the README says 64: Alert was approved as component 65 after it was written — docs/component-inventory.md"
  info "Thread has no row in the inventory and is shown under its own heading rather than counted"
else
  bad "gallery tier counts read: $counts"; fi

# ─────────────────────────────────────────────────────────────────────────────
printf '\n\033[1m%s checks passed.\033[0m\n' "$pass"
[ "$fail" -gt 0 ] && printf '\033[31m%s failing.\033[0m\n' "$fail"
exit $((fail > 0))
