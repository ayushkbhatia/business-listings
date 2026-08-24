#!/usr/bin/env bash
# The twelve acceptance criteria from handoffs/handoff-2-enquiry-engine/README.md,
# walked in order. Each one prints the evidence for itself rather than a tick.
#
# Needs: a seeded database, and the app built and served on :3000 for the
# criteria that are only observable in a browser. `pnpm db:seed` first.
set -uo pipefail

pass=0
fail=0
note() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '   \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '   \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
info() { printf '   note  %s\n' "$1"; }

LOG=/tmp/h2
mkdir -p "$LOG"

# One run per criterion, matched by test name, so a criterion that goes red
# names itself rather than hiding inside a suite total.
#
# Each helper fails when the filter matched *nothing*. A name filter that
# matches no tests exits zero, which reads as a pass and proves the opposite —
# handoff 0's criterion 1 sat green that way for two commits, and criterion 2
# here did the same on its first run.
vi() {
  pnpm exec vitest run --project "$1" -t "$2" >"$LOG/$3.log" 2>&1 || return 1
  grep -qE 'Tests +[0-9]+ passed' "$LOG/$3.log" || {
    printf '   \033[31mFAIL\033[0m  the filter "%s" matched no tests\n' "$2"
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
pwm() { pwx mobile "$1" "$2"; }
count() { grep -oE 'Tests +[0-9]+ passed' "$LOG/$1.log" | grep -oE '[0-9]+' | head -1; }

note "1. A buyer with no account can send to one seller and to five, and gets a reference"
if vi integration "criterion 1" c1; then
  ok "$(count c1) tests: ENQ ref allocated by a Postgres sequence, five recipients, all delivered"
  info "the account-less path builds a provisional Supabase identity and returns its claim token"
else
  bad "see $LOG/c1.log"; fi

note "2. A seller cannot retrieve the buyer's phone, email or company until acceptance"
if vi integration "criterion 2" c2; then
  ok "$(count c2) query-layer tests — the columns are never selected, so no screen can leak them"
  info "asserted again in the browser on /dashboard/leads: no surname, number or address on the page"
else
  bad "see $LOG/c2.log"; fi

note "3. Accepting a quote releases contact, declines the rest, and creates no other row"
if vi integration "creates no order, payment or fulfilment row" c3; then
  ok "row counts before and after: invoice, quote, enquiry, message, review and subscription all unchanged"
  info "there is no order table in this schema and criterion 3 is what keeps it that way"
else
  bad "see $LOG/c3.log"; fi

note "4. A revision is a new Quote row; the thread shows the previous price and the delta"
if vi integration "criterion 4" c4; then
  ok "$(count c4) tests: both revisions survive, the buyer sees only the current one"
  info "the delta is computed once in lib/messaging/thread-view.ts, so both sides read the same numbers"
else
  bad "see $LOG/c4.log"; fi

note "5. Median response time is measured, renders publicly, and no seller can write it"
if vi integration "computed from real timestamps" c5a && vi integration "no writable path" c5b; then
  ok "matches the raw recipient rows business by business; only lib/metrics writes the column"
else
  bad "see $LOG/c5a.log and $LOG/c5b.log"; fi
if pw "on the storefront" c5c; then
  ok "renders on the storefront in every band, with the unmeasured state saying so"
else
  bad "see $LOG/c5c.log"; fi

note "6. A Free-plan seller at their cap is excluded from matching, not shown and skipped"
if vi integration "criterion 6" c6; then
  ok "the capped seller is absent from the recipient list and present in the skipped log"
  info "the buyer's list simply has one fewer option and is never told why"
else
  bad "see $LOG/c6.log"; fi

note "7. A message containing an IBAN raises a SupplierReport with the message quoted"
if vi integration "criterion 7" c7; then
  ok "$(count c7) tests: report raised with a null reporter, message quoted, message flagged"
  info "ordinary trade language does not raise one — TRNs, phone numbers and letters of credit are stripped first"
else
  bad "see $LOG/c7.log"; fi
if pws "board 11b warning" c7b; then
  ok "the seller sees the warning from board 11b on the page, not in a comment"
else
  bad "see $LOG/c7b.log"; fi

note "8. No notification of any kind contains buyer contact details"
if vi integration "criterion 8" c8; then
  ok "$(count c8) tests across every template in the database, not the seed source"
  info "and at render time: a safe placeholder filled with an unsafe value throws rather than sends"
else
  bad "see $LOG/c8.log"; fi

note "9. A review needs a confirmed enquiry; removal without a reason throws and writes an audit row"
if vi integration "criterion 9" c9; then
  ok "$(count c9) tests: the gate, the throw, the audit row, and the database constraint under it"
  info "the four grounds are fixed. \"It is unfair\" is not one of them."
else
  bad "see $LOG/c9.log"; fi

note "10. Quiet hours suppress WhatsApp and SMS but not in-app, with the high-value override"
if vi unit "criterion 10" c10 && vi integration "criterion 10" c10b; then
  ok "$(count c10) unit tests on the decision, $(count c10b) end to end through the send layer"
  info "in-app is never deferred: nothing buzzes, and a list is the same list at seven"
else
  bad "see $LOG/c10.log and $LOG/c10b.log"; fi

note "11. Every screen in scope renders at its board's fidelity"
if pw "" c11a; then
  ok "$(grep -oE '[0-9]+ passed' "$LOG/c11a.log" | head -1) public and buyer specs"
else
  bad "see $LOG/c11a.log"; fi
if pws "" c11b; then
  ok "$(grep -oE '[0-9]+ passed' "$LOG/c11b.log" | head -1) seller specs, signed in through the real verify form"
else
  bad "see $LOG/c11b.log"; fi
# The first version of this walk ran chromium and seller only, and passed while
# four mobile specs were red — including a wizard whose Continue button could
# not be pressed on a phone at all. A criterion about fidelity that never looks
# at the narrow width is not checking the thing it names.
if pwm "" c11c; then
  ok "$(grep -oE '[0-9]+ passed' "$LOG/c11c.log" | head -1) of the same specs at 412px, where the enquiry actually gets sent"
else
  bad "see $LOG/c11c.log"; fi

note "12. Axe clean on the buyer routes, build clean, gallery renders the new tier 4 components"
if pnpm exec playwright test --project=chromium --project=seller --reporter=dot -g "axe" >"$LOG/c12a.log" 2>&1; then
  ok "$(grep -oE '[0-9]+ passed' "$LOG/c12a.log" | head -1) axe checks, colour-contrast excepted — see docs/contrast.md"
else
  bad "see $LOG/c12a.log"; fi
if pnpm exec tsc --noEmit >"$LOG/c12b.log" 2>&1 && pnpm build >"$LOG/c12c.log" 2>&1; then
  ok "tsc --noEmit clean, next build clean"
else
  bad "$(tail -4 "$LOG/c12b.log" "$LOG/c12c.log")"; fi
if pw "component is on the page" c12d; then
  ok "gallery renders all 18 + 17 + 15 + 12 components, including the five tier 4 this handoff added"
else
  bad "see $LOG/c12d.log"; fi

printf '\n\033[1m%s checks passed.\033[0m\n' "$pass"
[ "$fail" -eq 0 ] || printf '\033[31m%s failing.\033[0m\n' "$fail"
exit "$fail"
