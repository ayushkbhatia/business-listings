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

exit $fail
