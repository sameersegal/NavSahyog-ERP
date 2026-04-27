#!/usr/bin/env bash
#
# Reference deploy pattern for the L4.0c offline platform
# (decisions.md D31 — deploy-grace fix).
#
# Three env vars manage the build-id middleware:
#   * SERVER_BUILD_ID       — stamped on every response so clients
#                             can detect newer deploys.
#   * MIN_SUPPORTED_BUILD   — hard floor; clients older than this
#                             get 426'd. Default policy is to set
#                             this to the *previous* deploy's build
#                             so one-version-back keeps working
#                             through a fresh deploy.
#   * APP_BUILD             — passed to the web build so the bundle
#                             stamps it on every request.
#
# Run this from the repo root. Override env vars to force-upgrade
# the fleet (security-fix scenario): set MIN_SUPPORTED_BUILD to the
# *current* build instead of the previous one.

set -euo pipefail

# 1. Read the currently-deployed SERVER_BUILD_ID. If we've never
#    deployed before there's nothing to read; the very first deploy
#    leaves MIN_SUPPORTED_BUILD unset (no floor).
PREVIOUS_BUILD="$(
  wrangler deployments list --json 2>/dev/null \
    | jq -r '.[0].metadata.bindings[]
              | select(.name == "SERVER_BUILD_ID") | .text // empty' \
    | head -1
)"

# 2. Mint the new build-id. CI stamps it as `YYYY-MM-DD.<short-sha>`;
#    local invocations get a `.dev` suffix.
NEW_BUILD="$(date -u +%Y-%m-%d).${GITHUB_SHA:-dev}"
NEW_BUILD="${NEW_BUILD:0:18}"  # cap suffix at ~7 chars

echo "previous SERVER_BUILD_ID: ${PREVIOUS_BUILD:-<none>}"
echo "new SERVER_BUILD_ID:      ${NEW_BUILD}"

# 3. Build the web bundle with APP_BUILD baked in.
APP_BUILD="${NEW_BUILD}" pnpm --filter @navsahyog/web build

# 4. Deploy the worker with both env vars set:
#    * SERVER_BUILD_ID      = NEW_BUILD          — what's running now
#    * MIN_SUPPORTED_BUILD  = PREVIOUS_BUILD     — one version back
#
#    Use --var to inject them at deploy time; production should use
#    `wrangler secret put` for any value that's sensitive (build-ids
#    are not, so --var is fine).
DEPLOY_ARGS=(
  "--var" "SERVER_BUILD_ID:${NEW_BUILD}"
)
if [[ -n "${PREVIOUS_BUILD}" ]]; then
  DEPLOY_ARGS+=("--var" "MIN_SUPPORTED_BUILD:${PREVIOUS_BUILD}")
fi

pnpm --filter @navsahyog/api exec wrangler deploy "${DEPLOY_ARGS[@]}"

echo
echo "deploy complete."
echo "  SERVER_BUILD_ID    = ${NEW_BUILD}"
echo "  MIN_SUPPORTED_BUILD= ${PREVIOUS_BUILD:-<unset, no floor>}"
echo
echo "Clients older than ${PREVIOUS_BUILD:-<no floor>} will see 426"
echo "and the force-upgrade banner; clients on ${PREVIOUS_BUILD:-<any>}"
echo "or newer keep working. The soft 'Update available' banner fires"
echo "for any client whose build_date is older than ${NEW_BUILD%%.*}."
