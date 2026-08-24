#!/usr/bin/env bash
# Lighthouse on the three routes criterion 10 names. Uses Playwright's Chrome
# so there is nothing extra to install.
set -uo pipefail
export CHROME_PATH="${CHROME_PATH:-$(ls -d "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell 2>/dev/null | tail -1)}"
[ -x "$CHROME_PATH" ] || { echo "No Chrome found. Run: pnpm exec playwright install chromium"; exit 1; }

run() {
  local url="$1" out="$2"
  npx --yes lighthouse@12 "http://localhost:3000$url" \
    --only-categories=seo,accessibility,best-practices \
    --output=json --output-path="$out" \
    --chrome-flags="--headless=new --no-sandbox --disable-gpu" --quiet 2>/dev/null
  node -e "
    const r=require('$out'); const p=(k)=>Math.round(r.categories[k].score*100);
    console.log('  ' + '$url'.padEnd(40), 'SEO', String(p('seo')).padStart(3),
                '| a11y', String(p('accessibility')).padStart(3),
                '| best-practices', String(p('best-practices')).padStart(3));
    const fails=Object.values(r.audits).filter(a=>a.score!==null&&a.score<1&&a.scoreDisplayMode==='binary');
    for(const a of fails) console.log('        failing:', a.id, '—', a.displayValue||'');
  "
}

run "/" /tmp/lh_.json
run "/c/valves-and-fittings" /tmp/lh2.json
run "/b/al-marwan-industrial-supplies-llc" /tmp/lh_b_al-marwan-industrial-supplies-llc.json
