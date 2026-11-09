#!/usr/bin/env bash
# Acceptance criteria 3 and 4 from handoffs/handoff-0-foundation/README.md.
# Run as `pnpm check:tokens`. Exits non-zero on the first violation.
set -uo pipefail

fail=0

echo "→ 3. raw hex outside globals.css"
# Test files are excluded.
#
# The rule is that a component must not carry a colour: colours live in
# globals.css as variables so a token change moves every surface at once. A test
# that measures contrast has to name the colours it is measuring —
# `lib/theme/contrast.test.ts` asserts the storefront palette clears the §09.2
# floor, which it cannot do without writing it down.
#
# Excluding tests keeps the rule pointed at the thing it is about: a colour in a
# component is a colour no token can move.
if grep -rEn '#[0-9a-fA-F]{3,8}\b' \
     --include='*.tsx' --include='*.ts' \
     --exclude='*.test.ts' --exclude='*.test.tsx' \
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
# not string props, and not a single word or a string starting with a digit.
# 4c below takes the `.ts` half.
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

# 4c is a sentence written straight into a service module's refusal.
#
# `lib/spec/versions.ts` carried thirteen of them — "That template is not in the
# library.", "Only the live version can be added to." — and the spec-library
# screen printed them to an ops lead. They are user-visible strings by any
# reading of §5, and 4a could not see one: they are object properties in a `.ts`
# file, in a module that renders nothing.
#
# The shape, narrowly: a `message`, `error`, `fix`, `hint`, `note`, `label`,
# `body` or `placeholder` property whose value is a double-quoted sentence — a
# capitalised word, a space, another word. Narrow on purpose. A wider rule
# catches log lines, SQL fragments, enum labels and fixture data, and a check
# that cries wolf is a check somebody adds an exclusion to rather than reads.
#
# `/dev` is excluded for the reason it is excluded in 4b: it is not a product
# surface. Tests are excluded because a test that asserts a refusal has to name
# it.
#
# ## The seventeen
#
# This check is a fence, not a sweep. Seventeen modules were already over the
# line when it went in, and they are listed here rather than fixed in the same
# change: each needs its own keys, its own `fix` lines and a reader that resolves
# them, which is screen work per module and not one commit. Unlike
# `check-audit-coverage.mts`'s EXEMPT list these are not decisions, they are
# debt — so the check says so, with the number, and the number should only ever
# go down. Nothing new joins the list: a new module with a literal here fails.
OWED=(
  lib/alerts/service.ts
  lib/billing/entitlements-service.ts
  lib/billing/service.ts
  lib/content/demand.ts
  lib/content/drafts.ts
  lib/content/hold.ts
  lib/content/publish-rule.ts
  lib/dedupe/resolve.ts
  lib/dedupe/service.ts
  lib/ingest/queue.ts
  lib/listing/photos.ts
  lib/placement/rate-card.ts
  lib/reviews/disputes.ts
  lib/seo/curated/audit.ts
  lib/seo/landing/content.ts
  lib/taxonomy/rename.ts
  lib/taxonomy/service.ts
)

hits=$(grep -rEln '^[[:space:]]*(message|error|fix|hint|note|label|body|placeholder):[[:space:]]*"[A-Z][a-z]+ ' \
         --include='*.ts' \
         --exclude='*.test.ts' \
         --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=generated --exclude-dir=dev \
         lib 2>/dev/null | sort)

new_hits=""
while IFS= read -r file; do
  [ -z "$file" ] && continue
  known=0
  for owed in "${OWED[@]}"; do
    [ "$file" = "$owed" ] && known=1 && break
  done
  [ "$known" -eq 0 ] && new_hits="${new_hits}${file}"$'\n'
done <<< "$hits"

if [ -n "$new_hits" ]; then
  printf '%s' "$new_hits"
  echo "   FAIL — a refusal a person reads belongs in en.ts. Return the key, resolve it on the screen."
  fail=1
else
  echo "   pass — 4c, service-module strings"
  echo "   note  ${#OWED[@]} modules still owe this, listed in the script. The number only goes down."
fi

exit $fail
