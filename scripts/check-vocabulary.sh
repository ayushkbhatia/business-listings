#!/usr/bin/env bash
# The vocabulary and identity rules from CLAUDE.md, enforced instead of remembered.
# Run as `pnpm check:vocabulary`. Exits non-zero on the first violation.
#
# Prose in an always-loaded instruction file is the weakest enforcement available.
# These rules regressed often enough to be worth a CI job.
set -uo pipefail

fail=0
CATALOGUE=lib/i18n/en.ts

# Only the right-hand side of each entry is copy. A key may say `promote.buy`
# while its string reads "Take this slot", and a comment that explains why a
# word is banned has to be allowed to write the word down.
raw() { grep -nEv '^\s*(//|\*|/\*)' "$CATALOGUE"; }
# Blank the key so a match lands on copy and not on an identifier.
only_values() { sed -E 's/"[a-zA-Z0-9_.]+":/:/'; }
values() { raw | only_values; }

echo "→ 1. words for things that do not exist"
# The pivot list from CLAUDE.md. `buy` carries a word boundary because `buyer`
# is core vocabulary. `get quote\b` is the singular CTA — "get quotes back" is
# ordinary English about the thing that actually comes back.
BANNED='\b(cart|basket|checkout|purchase|payout|refund|dispatch|GMV|POD)\b'
BANNED+='|price on request|price: low to high|download price list'
BANNED+='|get quote\b|get a quote|add to cart'
if values | grep -inE "$BANNED"; then
  echo "   FAIL — these name a cart, a checkout or an order entity. None exist."
  echo "          enquiry · quote · accepted quote · subscription credit · quoted value."
  fail=1
else
  echo "   pass"
fi

echo "→ 2. \"order\" in its commerce sense"
# Bare `order` is not the rule. "Made to order", "indent order", "minimum order
# quantity" and a buyer's own "orders over AED 25,000 need approval" describe the
# buyer's or supplier's own process. So does every ordinal use — sort position,
# "in any order", "the order people joined". What does not exist is the noun:
# a thing the platform creates, numbers, tracks and confirms.
# "The order" is almost always ordinal in English, so only the possessive and
# the transactional verb-and-noun phrases are banned.
ORDER='\b(your|my) orders?\b'
ORDER+='|\border (total|history|number|id|status|summary|details|confirmation)\b'
ORDER+='|\b(place|track|cancel|repeat|reorder) (an? )?order\b'
ORDER+='|\borders? (placed|shipped|delivered|confirmed)\b'
if values | grep -inE "$ORDER"; then
  echo "   FAIL — the conversion event is an enquiry; the terminal state is an accepted quote."
  fail=1
else
  echo "   pass"
fi

echo "→ 3. legal suffixes in copy"
# A supplier's name comes from the database, never from the catalogue. Hints and
# placeholders are exempt: a field that asks for a company needs to show one.
if raw | grep -vE '"[a-zA-Z0-9_.]*(hint|placeholder|example)":' \
   | only_values | grep -E '\b(LLC|L\.L\.C|FZE|FZCO|FZ-LLC|Trading Co\.)\b'; then
  echo "   FAIL — seller identity is displayName, and it comes from the database."
  fail=1
else
  echo "   pass"
fi

echo "→ 4. tradeName rendered where displayName is owed"
# CLAUDE.md: seller identity is always displayName — h1, identity strips,
# comparison rows, cards, search results, recipient lists, JSON-LD. `tradeName`
# reaches a surface in one place, the storefront details panel.
#
# A comparison row links to that seller's storefront. A trade name in the row
# means the buyer reads one name and lands on another.
#
# Prisma selects, type declarations and props passed into an editor are not
# renders — a form that edits the licence-locked value has to receive it. Every
# other site either switches to displayName or carries `licence-locked` on its
# own line, which is the deliberate decision this check exists to force.
if grep -rn 'tradeName' --include='*.tsx' app components 2>/dev/null \
   | grep -vE 'licence-locked' \
   | grep -vE 'tradeName\??: (true|string)' \
   | grep -vE '(tradeName|current|defaultValue)=\{[a-zA-Z.]*tradeName\}'; then
  echo '   FAIL — use displayName, or mark the line `licence-locked` if it is the panel.'
  fail=1
else
  echo "   pass"
fi

echo "→ 5. provenance labels for things that were never bought"
# Board 1m criterion 1. The ladder inverted at the pivot: an accepted quote is
# the strongest rung a platform holding no transactions can prove, "Verified
# enquiry" is the one below it, and there is no third. The four labels banned
# here all imply a purchase — and one of them, "Verified buyer", shipped in this
# catalogue as the anonymous reviewer's name until the reviews page was built
# against the board.
#
# Scanned across app/ and components/ as well as the catalogue, because a badge
# label written straight into JSX would pass a check that only reads en.ts, and
# a two-word label is exactly the kind of string that gets written there.
#
# Comments are stripped from the JSX scan for the same reason `raw` strips them
# from the catalogue: prose explaining why a word is banned has to be allowed to
# write the word down.
PROVENANCE='verified (purchase|buyer|customer|order)'
jsx_copy() {
  find app components -name '*.tsx' -not -path '*/node_modules/*' -print0 \
    | xargs -0 perl -0777 -ne '
        s{(/\*.*?\*/)}{ $1 =~ s/[^\n]//gr }gse;
        s{^(\s*)//.*$}{$1}gm;
        my @lines = split /\n/, $_, -1;
        for my $i (0 .. $#lines) { printf "%s:%d:%s\n", $ARGV, $i + 1, $lines[$i]; }
      '
}
if { values; jsx_copy; } | grep -iE "$PROVENANCE"; then
  echo "   FAIL — nothing is purchased here. Accepted quote (ok) · Verified enquiry (neutral)."
  fail=1
else
  echo "   pass"
fi

exit $fail
