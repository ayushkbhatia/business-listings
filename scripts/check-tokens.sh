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
# Two greps, because one shape of string was invisible to the first for a year.
#
# 4a is JSX text — text sitting immediately after a `>`. It is what this check
# has always been, and it only ever saw that one shape: not object properties,
# not string props, not `.ts` files, and not a single word or a string starting
# with a digit. Widening it further is worth doing and is not this change.
if grep -rEn '>[A-Z][a-z]+ [a-z]+' \
     --include='*.tsx' \
     --exclude-dir=node_modules --exclude-dir=.next \
     app components 2>/dev/null; then
  echo "   FAIL — wrap it in t(). English is a locale, not the source."
  fail=1
else
  echo "   pass — 4a, JSX text"
fi

# 4b is `metadata.title`, which 4a cannot see because it is an object property.
# Forty-seven pages carried a literal there, and twenty-four of them duplicated
# an English string that already existed in en.ts under the key the same page's
# own h1 was reading — so the tab title and the heading were two copies of one
# string, and only one of them was checked.
#
# A page title is the browser tab and the search-result headline, so it is
# user-visible by any reading, and §5 of CLAUDE.md does not carve it out.
#
# Scoped to the files metadata can be exported from, which keeps this pointed at
# titles rather than at every `title:` in the codebase — a `title` column on a
# table or a `title: string` on an interface is not a string anybody reads.
# /dev is excluded for the reason it is excluded everywhere: it is not a product
# surface.
if grep -rEn '^\s*(export const metadata[^=]*= \{ )?title: "' \
     --include='page.tsx' --include='layout.tsx' \
     --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dev \
     app 2>/dev/null; then
  echo "   FAIL — a page title is user-visible. Put it in en.ts and call t()."
  fail=1
else
  echo "   pass — 4b, metadata titles"
fi

exit $fail
