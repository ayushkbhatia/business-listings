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
check '^[[:space:]]*(price|priceAed|unitPriceAed|currency|pricingTier)[[:space:]]' "Product carries no price field"
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

exit $fail
