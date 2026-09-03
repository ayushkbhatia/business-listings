#!/usr/bin/env bash
# Non-negotiable 4 from CLAUDE.md: real table markup.
# Run as `pnpm check:markup`. Exits non-zero on the first violation.
#
# The design canvas draws tables with divs for layout reasons and the build must
# not follow it. This is the only non-negotiable that had no check, and the tree
# was clean when it was written — a regression guard, not a cleanup.
set -uo pipefail

# JSX splits an opening tag over many lines, so a line-based grep is wrong twice
# over: it reports every multi-line `<th>` as an offender, and when it filters
# for `scope=` it drops that one line and keeps the rest of a compliant tag.
# Both checks therefore slurp the file and test each tag whole.
#
# Comments are blanked rather than deleted, so reported line numbers still match
# the file: `<th scope>` appears inside the doc comments on DataTable and
# SpecComparison, which is prose about the rule rather than a breach of it.
scan() {
  perl -0777 -ne '
    s{(/\*.*?\*/)}{ $1 =~ s/[^\n]//gr }gse;
    s{^(\s*)//.*$}{$1}gm;
    while (/$ENV{PATTERN}/g) {
      my $tag = $&;
      next if $ENV{REQUIRE} ne "" && $tag =~ /$ENV{REQUIRE}/;
      my $line = 1 + (substr($_, 0, $-[0]) =~ tr/\n//);
      $tag =~ s/\s+/ /g;
      printf "%s:%d: %.90s\n", $ARGV, $line, $tag;
    }
  ' "$1"
}

run() {
  local found=""
  while IFS= read -r file; do
    hit=$(scan "$file")
    [ -n "$hit" ] && found+="$hit"$'\n'
  done < <(find app components -name '*.tsx' -not -path '*/node_modules/*' | sort)
  printf '%s' "$found"
  [ -n "${found//[$'\n' ]/}" ]
}

fail=0

echo "→ 4a. <th> without scope"
PATTERN='<th(?=[\s/>])[^>]*>' REQUIRE='\bscope="(col|row|colgroup|rowgroup)"'
export PATTERN REQUIRE
if run; then
  echo '   FAIL — every <th> carries scope="col" or scope="row".'
  fail=1
else
  echo "   pass"
fi

echo "→ 4b. divs wearing table roles"
# A div with role="row" is the canvas's layout table reaching the build. Real
# <table> markup needs no ARIA to say what it already is, and none of these
# roles appears in the tree today.
PATTERN='role="(table|grid|row|rowgroup|columnheader|rowheader|cell|gridcell)"' REQUIRE=''
export PATTERN REQUIRE
if run; then
  echo "   FAIL — use <table>, <thead>, <tr>, <th scope>. Not divs with ARIA."
  fail=1
else
  echo "   pass"
fi

exit $fail
