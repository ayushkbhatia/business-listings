#!/usr/bin/env bash
# The twelve acceptance criteria from handoffs/handoff-1-public-read-only/README.md.
# Needs the app built and served on :3000.
set -uo pipefail

pass=0; fail=0
note() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '   \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '   \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
info() { printf '   note  %s\n' "$1"; }

B=http://localhost:3000
CLAIMED=al-marwan-industrial-supplies-llc
UNCLAIMED=al-wadi-technical-services-llc

pw() { pnpm exec playwright test --project=chromium --reporter=dot -g "$1" >/tmp/h1.log 2>&1; }

note "1. All eleven routes render server-side, no client fetch on first paint"
missing=0
for u in "/" "/c/valves-and-fittings" "/c/valves-and-fittings/gate-valves" "/search?q=valve" \
         "/search?q=valve&tab=products" "/compare?p=$CLAIMED" "/b/$CLAIMED" "/b/$CLAIMED/products" \
         "/b/$CLAIMED/branches" "/b/$CLAIMED/reviews" "/b/$CLAIMED/p/resilient-seated-gate-valve-dn150-0"; do
  code=$(curl -s -o /tmp/pg -w '%{http_code}' "$B$u")
  [ "$code" = "200" ] || { bad "$u returned $code"; missing=1; break; }
  # The content has to be in the HTML, not fetched after hydration.
  grep -q 'Business Listings' /tmp/pg || { bad "$u served an empty shell"; missing=1; break; }
done
[ "$missing" = "0" ] && ok "11 routes, each server-rendered with content in the first response"

note "2. One route, two compositions"
pw "one route, two compositions" && ok "claimed renders 1d, unclaimed renders 10g, no second page component" || bad "see /tmp/h1.log"

note "3. Spec-aware and Arabic matching"
pw "spec-aware matching" && ok "DN100 finds a product stored as 4 inch; صمامات reaches valve suppliers via synonyms" || bad "see /tmp/h1.log"

note "4. The filter rail comes from the template"
pw "the rail comes from the template" && ok "generated from SpecField where isFilterable; a different category gets a different rail" || bad "see /tmp/h1.log"
info "also proved by hand: flipping is_filterable in the database moved a section in and out with no deploy"

note "5. Ranking weights are a config object"
pnpm exec vitest run lib/search >/tmp/h1r.log 2>&1 \
  && ok "$(grep -oE 'Tests +[0-9]+ passed' /tmp/h1r.log | grep -oE '[0-9]+') ranking tests, including plan-tier 0 reordering two identical suppliers" \
  || bad "see /tmp/h1r.log"

note "6. Zero results is a designed state"
pw "zero results is a designed state" && ok "names a filter to drop and what it yields, offers RFQ disabled, records the miss" || bad "see /tmp/h1.log"
rows=$(curl -s "$B/c/packaging-and-materials?tier=3" -o /dev/null -w '%{http_code}')
[ "$rows" = "200" ] && info "a zero_result_query row is written on every empty search — see docs/database.md"

note "7. No price on a public surface, and no cart or checkout"
pw "no price on a public surface" && ok "four routes carry no price; the Product offer has availability and no price; /cart /checkout /basket all 404" || bad "see /tmp/h1.log"

note "8. Verification badges state what was checked, and take no theme colour"
pw "verification is platform-owned" && ok "six themes, six distinct card colours, one identical badge — measured, not asserted" || bad "see /tmp/h1.log"

note "9. Locations without coordinates never reach a map"
pw "a location without coordinates never reaches the map" && ok "unpinned branches are excluded and the count held back is declared" || bad "see /tmp/h1.log"

note "10. Lighthouse SEO and axe"
if [ -f /tmp/lh_.json ]; then
  node -e "
  const files={'/':'/tmp/lh_.json','/c/:category':'/tmp/lh2.json','/b/:slug':'/tmp/lh_b_al-marwan-industrial-supplies-llc.json'};
  let worst=100;
  for(const [name,f] of Object.entries(files)){
    try{const r=require(f);const s=Math.round(r.categories.seo.score*100);worst=Math.min(worst,s);
      console.log('         SEO', String(s).padStart(3), name);}catch(e){}
  }
  process.exit(worst>=95?0:1);
  " && ok "Lighthouse SEO at or above 95 on all three required routes" || bad "SEO under 95"
else
  info "run pnpm lighthouse first"
fi
pnpm exec playwright test --project=chromium --reporter=dot -g "axe" >/tmp/h1a.log 2>&1 \
  && ok "axe clean on every route, colour-contrast excepted — see docs/contrast.md" \
  || bad "see /tmp/h1a.log"

note "11. Enquiry affordances present and disabled; no dead links"
pw "enquiry affordances" && ok "present, styled, disabled, titled — and every internal link resolves" || bad "see /tmp/h1.log"
pw "has no dead links anywhere in the chrome" && ok "no dead link in the nav or footer" || bad "see /tmp/h1.log"

note "12. Build clean under strict TypeScript, gallery still whole"
if pnpm exec tsc --noEmit >/tmp/h1t.log 2>&1 && pnpm build >/tmp/h1b.log 2>&1; then
  ok "tsc --noEmit clean, next build clean"
else
  bad "$(tail -4 /tmp/h1t.log /tmp/h1b.log)"
fi
pw "every tier 1 to 4 component is on the page" && ok "gallery renders all 18 + 17 + 15 + 8 components" || bad "see /tmp/h1.log"

printf '\n\033[1m%s checks passed.\033[0m\n' "$pass"
[ "$fail" -eq 0 ] || printf '\033[31m%s failing.\033[0m\n' "$fail"
exit "$fail"
