#!/usr/bin/env bash
#
# Vercel's Ignored Build Step. Wired up as `ignoreCommand` in vercel.json, and
# run by Vercel in the Root Directory when a deployment enters BUILDING.
#
# The exit codes are inverted, and they are the whole point of this file:
#
#   exit 1 → the build continues
#   exit 0 → the build is aborted and the deployment is marked CANCELED
#
# That is Vercel's wording, not a paraphrase: "When the command exits with code
# 1, the build will continue. When the command exits with 0, the build is
# ignored." Getting it backwards here means either every push builds, or
# production stops deploying — so the two `exit` lines below are commented.
#
# WHY: every push to every branch used to build. A deploy is billed build time,
# and on Vercel each new deployment gets its own ISR cache rather than reusing
# the previous one, so a production deploy also leaves every page cold for the
# next visitor. Measured on the sibling indus-hydraulics project on 2026-08-26:
# ~100 deployments in 2 days and ~200 build-minutes/day on a site with almost no
# human traffic. Deploys, not visitors, were the bill.
#
# So preview builds are opt-in. Production is not gated.
#
# Docs: docs/deployments.md
#
set -uo pipefail

vercel_env="${VERCEL_ENV-}"
ref="${VERCEL_GIT_COMMIT_REF-}"
message="${VERCEL_GIT_COMMIT_MESSAGE-}"

# Production always builds. `VERCEL_ENV` is the real test; the branch name is a
# second one, so that a missing or renamed environment variable fails towards
# deploying rather than towards a merge to main that silently never ships.
if [ "$vercel_env" = "production" ] || [ "$ref" = "main" ]; then
  echo "vercel-ignore-build: production (VERCEL_ENV=${vercel_env:-unset}, ref=${ref:-unset}) — building"
  exit 1
fi

# A preview is built when the commit that triggered it asks for one. The quotes
# make the brackets literal rather than a character class.
case "$message" in
  *"[preview]"*)
    echo "vercel-ignore-build: [preview] in commit message — building"
    exit 1
    ;;
esac

echo "vercel-ignore-build: preview build not requested — skipping"
echo "  Add [preview] to a commit message to build this branch, e.g."
echo "  git commit --allow-empty -m 'chore: preview build [preview]'"
exit 0
