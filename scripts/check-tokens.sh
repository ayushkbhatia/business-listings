#!/usr/bin/env bash
# Acceptance criteria 3 and 4 from handoffs/handoff-0-foundation/README.md.
# Run as `pnpm check:tokens`. Exits non-zero on the first violation.
set -uo pipefail

fail=0

echo "→ 3. raw hex outside globals.css"
if grep -rEn '#[0-9a-fA-F]{3,8}\b' \
     --include='*.tsx' --include='*.ts' \
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
