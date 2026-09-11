#!/usr/bin/env bash
# Acceptance criterion 9. The three shapes that would each be a migration to undo:
# no price on Product, no order table, no payout field.
set -uo pipefail

SCHEMA=prisma/schema.prisma
fail=0

# Strip // comments and blank lines — the schema documents these bans in prose.
#
# Read once into a variable rather than re-running a pipeline per check. Under
# `pipefail` a `code | grep -q` returns 141, not 0, whenever grep exits on its
# match while sed is still writing: the match succeeded and the pipeline still
# reports failure. The schema is around the size of a pipe buffer, so whether
# that happened came down to how loaded the machine was. It cost a false pass
# and a false failure on two CI runs twenty minutes apart, on the same file.
CODE=$(sed -E 's://.*$::' "$SCHEMA" | grep -v '^[[:space:]]*$')

check() {
  local pattern="$1" label="$2"
  local hits
  hits=$(grep -inE "$pattern" <<<"$CODE" || true)
  if [ -n "$hits" ]; then
    echo "   FAIL — $label"
    echo "$hits" | sed 's/^/     /'
    fail=1
  else
    echo "   pass — $label"
  fi
}

echo "→ 9. schema invariants"

# Scoped to the `Product` model, which is what this check has always claimed to
# be about.
#
# It used to grep the whole file, so it fired on `Invoice.currency` — a field a
# tax document is legally required to state (board 11g, criterion 5). Widening
# the exception list would have been the wrong repair: the ban is about
# `Product`, and a check that names one model and reads every model is one that
# gets an exception added to it every time an unrelated table grows a column,
# until it bans nothing.
#
# Scoping it also makes it stricter where it matters. `price` on `Product` was
# only ever caught because no other model happened to use the word.
PRODUCT=$(awk '/^model Product \{/,/^\}/' <<<"$CODE")

check_in() {
  local body="$1" pattern="$2" label="$3"
  local hits
  hits=$(grep -inE "$pattern" <<<"$body" || true)
  if [ -n "$hits" ]; then
    echo "   FAIL — $label"
    echo "$hits" | sed 's/^/     /'
    fail=1
  else
    echo "   pass — $label"
  fi
}

check_in "$PRODUCT" '^[[:space:]]*(price|priceAed|unitPriceAed|currency|pricingTier)[[:space:]]' "Product carries no price field"
check '^[[:space:]]*model[[:space:]]+(Order|OrderLine|Payment|Fulfilment|Fulfillment)[[:space:]]*\{' "no order/payment/fulfilment model"
check 'payout|commissionRate|transactionFee|escrow' "no payout, commission, transaction fee or escrow"

# QuoteLine.unitPrice is the one legitimate price and must exist once models land.
if grep -qE '^[[:space:]]*model[[:space:]]+QuoteLine[[:space:]]*\{' <<<"$CODE"; then
  if grep -qE '^[[:space:]]*unitPrice[[:space:]]' <<<"$CODE"; then
    echo "   pass — QuoteLine.unitPrice is the single price field"
  else
    echo "   FAIL — QuoteLine exists but has no unitPrice. That is the only price in the schema."
    fail=1
  fi
fi

# Invariants Prisma has no syntax for, so a regeneration cannot express them and
# would quietly drop them. Each is asserted against the migration that owns it.
#
# Board 11f Q8: one pending plan change per business. Two make the effective-date
# arithmetic uncheckable, because the second would have to know whether the first
# had landed to know what it was changing from.
if grep -qE '^[[:space:]]*model[[:space:]]+SubscriptionChange[[:space:]]*\{' <<<"$CODE"; then
  if grep -rqE 'CREATE UNIQUE INDEX[^;]*"subscription_change_one_pending"' prisma/migrations; then
    echo "   pass — one pending subscription change per business, by partial unique index"
  else
    echo "   FAIL — SubscriptionChange exists with no subscription_change_one_pending index."
    echo "     Prisma cannot express a partial unique index; it lives in the migration."
    fail=1
  fi
fi

# Board 3l. `category_position_day` identifies a row by business, category, day
# and emirate — and `emirate` is null for a country-wide browse. A null never
# equals a null in SQL, so a plain unique index would accept two country-wide
# rows for one business on one day and the rollup would count the same browse
# twice for ever. Two partial indexes are the identity, and Prisma cannot
# express either.
if grep -q 'category_position_day_countrywide' prisma/migrations/*/migration.sql 2>/dev/null \
   && grep -q 'category_position_day_in_emirate' prisma/migrations/*/migration.sql 2>/dev/null; then
  echo "   pass — category positions are identified by two partial unique indexes"
else
  echo "   FAIL — category_position_day has lost a partial unique index."
  echo "          Without both, a country-wide browse inserts a new row every time."
  fail=1
fi

# Board 11c. One **open** dispute per review, and any number of settled ones.
#
# Prisma cannot express `WHERE resolved_at IS NULL`, and the plain unique index
# it *can* express would say the wrong thing in both directions: it would let two
# tabs file the same dispute twice — one case decided twice, on a queue whose
# promise is a decision in two working days — and it would forbid the second,
# legitimate dispute a buyer's edit inside their editable fortnight produces.
if grep -qE '^[[:space:]]*model[[:space:]]+ReviewDispute[[:space:]]*\{' <<<"$CODE"; then
  if grep -rqE 'CREATE UNIQUE INDEX[^;]*"review_dispute_one_open_per_review"' prisma/migrations; then
    echo "   pass — one open review dispute per review, by partial unique index"
  else
    echo "   FAIL — ReviewDispute exists with no review_dispute_one_open_per_review index."
    echo "     Prisma cannot express a partial unique index; it lives in the migration."
    fail=1
  fi
fi

# The 3a + 3l amendment. `category_rank_day` carries the same nullable-emirate
# identity for the same reason, and one more invariant of its own: a rank cannot
# exceed its denominator. `#7 of 5` is not a near miss — it is a job that ranked
# one set and counted another, and both numbers render as numbers.
if grep -qE '^[[:space:]]*model[[:space:]]+CategoryRankDay[[:space:]]*\{' <<<"$CODE"; then
  if grep -q 'category_rank_day_countrywide' prisma/migrations/*/migration.sql 2>/dev/null \
     && grep -q 'category_rank_day_in_emirate' prisma/migrations/*/migration.sql 2>/dev/null; then
    echo "   pass — nightly category ranks are identified by two partial unique indexes"
  else
    echo "   FAIL — category_rank_day has lost a partial unique index."
    echo "          Without both, the nightly job inserts a second country-wide row each run."
    fail=1
  fi

  if grep -rqE '"category_rank_day_rank_within_total"' prisma/migrations; then
    echo "   pass — a nightly rank cannot exceed its own denominator"
  else
    echo "   FAIL — category_rank_day has lost its rank-within-total check."
    fail=1
  fi
fi

# The amendment's B2. Attribution reads the weights that were in force on the
# day, not the weights that are in force now. Without the column a staff slider
# move on 12c is indistinguishable from the seller's own decline, and every such
# fall is billed to the seller — the defect the amendment exists to stop.
if grep -qE '^[[:space:]]*model[[:space:]]+ListingFactorDay[[:space:]]*\{' <<<"$CODE"; then
  if grep -qE '^[[:space:]]*weights[[:space:]]+Json' <<<"$CODE"; then
    echo "   pass — factor history stores the weights in force that day"
  else
    echo "   FAIL — ListingFactorDay has no weights vector."
    echo "          Attribution cannot then tell a staff weight change from a seller's decline."
    fail=1
  fi
fi

# Board `2d-s`. One coverage row per scope, and Prisma can express neither half.
#
# `(business, emirate, NULL)` duplicates freely under a plain unique index,
# because NULL is distinct from NULL in SQL — which is the row a seller creates
# by clicking Dubai twice on a slow connection, and it renders as the emirate
# claimed twice on their own listing. `business_coverage` carries the same pair
# for the same reason; this asserts the newer one, where a regeneration is the
# thing most likely to drop it.
if grep -qE '^[[:space:]]*model[[:space:]]+ServiceCoverage[[:space:]]*\{' <<<"$CODE"; then
  if grep -rqE '"service_coverage_business_id_area_id_key"' prisma/migrations \
     && grep -rqE '"service_coverage_business_id_emirate_key"' prisma/migrations; then
    echo "   pass — one service coverage row per scope, by two partial unique indexes"
  else
    echo "   FAIL — service_coverage has lost a partial unique index."
    echo "     Without both, one business claims the same emirate any number of times."
    fail=1
  fi
fi

# Board 12c Q7. A boost names a listing or a category, never both and never
# neither. Prisma expresses neither half: the relation is two optional foreign
# keys, which permits a row with both set — a boost that lifts one supplier and
# every supplier in a category at once, with one points value and no way to say
# which it meant — and a row with neither, which is a boost that boosts nothing
# and still spends a business's budget when the cap counts it.
if grep -qE '^[[:space:]]*model[[:space:]]+ListingBoost[[:space:]]*\{' <<<"$CODE"; then
  if grep -rqE '"listing_boost_one_target"' prisma/migrations; then
    echo "   pass — a boost names exactly one of a listing and a category"
  else
    echo "   FAIL — listing_boost has lost its one-target check."
    echo "          Prisma cannot express it; two optional relations permit both and neither."
    fail=1
  fi

  if grep -rqE '"listing_boost_emirate_needs_category"' prisma/migrations; then
    echo "   pass — a boost emirate only narrows a category boost"
  else
    echo "   FAIL — listing_boost has lost its emirate check."
    echo "          An emirate on a listing-targeted boost says nothing the listing does not."
    fail=1
  fi
fi

exit $fail
