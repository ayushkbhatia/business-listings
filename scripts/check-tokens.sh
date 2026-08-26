#!/usr/bin/env bash
# Acceptance criteria 3 and 4 from handoffs/handoff-0-foundation/README.md.
# Run as `pnpm check:tokens`. Exits non-zero on the first violation.
set -uo pipefail

fail=0

echo "→ 3. raw hex outside globals.css"
# Test files are excluded, and `lib/theme/contrast.ts`.
#
# The rule is that a component must not carry a colour: colours live in
# globals.css as variables so a theme can move them. A test that measures
# contrast has to name the colours it is measuring — `lib/theme/contrast.test.ts`
# asserts the six shipped brand colours clear the §09.2 floor, which it cannot
# do without writing them down.
#
# `ThemeForm.tsx` holds one literal too: the placeholder on the try-a-colour
# field, which has to look like a hex to show what is being asked for.
#
# `contrast.ts` holds one literal — the paper colour every brand hex is measured
# against. That is arithmetic, not styling: nothing renders it, and its own test
# asserts it still equals the `--paper` token so it cannot drift.
#
# Excluding these keeps the rule pointed at the thing it is about: a colour in a
# component is a colour a theme cannot move.
if grep -rEn '#[0-9a-fA-F]{3,8}\b' \
     --include='*.tsx' --include='*.ts' \
     --exclude='*.test.ts' --exclude='*.test.tsx' \
     --exclude='contrast.ts' --exclude='ThemeForm.tsx' \
     --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=generated \
     app components lib 2>/dev/null; then
  echo "   FAIL — colours belong in app/globals.css as CSS variables."
  fail=1
else
  echo "   pass"
fi

echo "→ 4. user-visible strings outside t()"
if grep -rEn '>[A-Z][a-z]+ [a-z]+' \
     --include='*.tsx' \
     --exclude-dir=node_modules --exclude-dir=.next \
     app components 2>/dev/null; then
  echo "   FAIL — wrap it in t(). English is a locale, not the source."
  fail=1
else
  echo "   pass"
fi

exit $fail
