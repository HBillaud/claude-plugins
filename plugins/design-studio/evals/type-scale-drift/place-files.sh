#!/usr/bin/env bash
# Builds ./coastline, the three-page site this case hands to the agent.
set -euo pipefail

main() {
  python3 "$(dirname -- "$0")/files/make_site.py" coastline
  # The agent runs in a sandbox that cannot install Playwright or read the operator's copy.
  bash "$(dirname -- "$0")/../_lib/provision-playwright.sh"
}

main "$@"
