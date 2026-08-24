#!/usr/bin/env bash
# The ten acceptance criteria from handoffs/handoff-0-foundation/README.md,
# walked in order. Each one prints its own evidence.
#
# Needs the app built and served on :3000 for criteria 1, 2 and 8.
set -uo pipefail

pass=0
fail=0
note() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '   \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '   \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }

note "1. /dev/gallery renders every tier 1 and tier 2 component"
if pnpm exec playwright test --project=chromium -g "every tier 1 and tier 2 component" --reporter=dot >/tmp/a1.log 2>&1; then
  ok "18 tier 1 + 17 tier 2 + 4 shells present, asserted by id"
else
  bad "see /tmp/a1.log"; fi
printf '   note  every *state* is diffable only against design-system §02–§05, which is canvas-only. See docs/inferred.md.\n'

note "2. The three shells render at all three densities"
if pnpm exec playwright test --project=chromium -g "three densities" --reporter=dot >/tmp/a2.log 2>&1; then
  ok "roomy auto/18px · comfortable 46/14 · compact 38/10, resolved from the same components"
else
  bad "see /tmp/a2.log"; fi

note "3. No raw hex outside globals.css"
hits=$(grep -rEn '#[0-9a-fA-F]{3,8}\b' --include='*.tsx' --include='*.ts' \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=generated \
  app components lib 2>/dev/null | wc -l | tr -d ' ')
if [ "$hits" = "0" ]; then ok "grep over app, components and lib returns nothing"; else
  bad "$hits occurrence(s)"; grep -rEn '#[0-9a-fA-F]{3,8}\b' --include='*.tsx' --include='*.ts' --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=generated app components lib | head -5; fi

note "4. No user-visible string outside t()"
hits=$(grep -rEn '>[A-Z][a-z]+ [a-z]+' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=.next app components 2>/dev/null | wc -l | tr -d ' ')
if [ "$hits" = "0" ]; then ok "grep over app and components returns nothing"; else
  bad "$hits occurrence(s)"; grep -rEn '>[A-Z][a-z]+ [a-z]+' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=.next app components | head -5; fi

note "5. Every formatter has a test, including the masking ones"
if pnpm exec tsx scripts/check-formatter-coverage.mts >/tmp/a5.log 2>&1; then
  sed -n '2,$p' /tmp/a5.log | sed 's/^/   /' | tail -3
  ok "$(grep -c 'pass —' /tmp/a5.log) formatters covered"
else
  bad "$(grep 'FAIL' /tmp/a5.log | head -3)"; fi

note "6. A staff_moderator calling a tier change is rejected server-side"
if pnpm exec vitest run lib/auth >/tmp/a6.log 2>&1; then
  ok "$(grep -oE 'Tests +[0-9]+ passed' /tmp/a6.log | grep -oE '[0-9]+') permission tests, six of them named for criterion 6"
else
  bad "see /tmp/a6.log"; fi

note "7. A staff mutation without a reason throws"
if pnpm exec vitest run lib/audit >/tmp/a7.log 2>&1; then
  ok "$(grep -oE 'Tests +[0-9]+ passed' /tmp/a7.log | grep -oE '[0-9]+') audit tests, five of them named for criterion 7"
else
  bad "see /tmp/a7.log"; fi

note "8. Axe passes on the gallery"
if pnpm exec playwright test --project=chromium -g "axe|landmarks|accessible name|real table markup" --reporter=dot >/tmp/a8.log 2>&1; then
  ok "every axe rule clean except colour-contrast, which is token-level — see docs/contrast.md"
else
  bad "see /tmp/a8.log"; fi

note "9. Schema carries no price on Product, no order table, no payout"
if ./scripts/check-schema-invariants.sh >/tmp/a9.log 2>&1; then
  sed -n '2,$p' /tmp/a9.log | sed 's/^ */   /'
  ok "schema invariants hold"
else
  bad "$(cat /tmp/a9.log)"; fi

note "10. pnpm build clean under TypeScript strict"
if pnpm exec tsc --noEmit >/tmp/a10a.log 2>&1 && pnpm build >/tmp/a10.log 2>&1; then
  ok "tsc --noEmit clean, next build clean"
else
  bad "$(tail -5 /tmp/a10a.log /tmp/a10.log)"; fi

printf '\n\033[1m%s of 10 criteria pass.\033[0m\n' "$pass"
[ "$fail" -eq 0 ] || printf '\033[31m%s failing.\033[0m\n' "$fail"
exit "$fail"
