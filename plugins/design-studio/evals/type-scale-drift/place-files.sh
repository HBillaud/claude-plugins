#!/usr/bin/env bash
# Builds ./coastline, the three-page site this case hands to the agent.
set -euo pipefail

main() {
  python3 "$(dirname -- "$0")/files/make_site.py" coastline
}

main "$@"
