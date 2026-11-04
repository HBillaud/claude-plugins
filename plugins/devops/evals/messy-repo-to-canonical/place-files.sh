#!/usr/bin/env bash
# Builds ./orbit, the messy repository this case hands to the agent.
set -euo pipefail

main() {
  python3 "$(dirname -- "$0")/files/make_messy_repo.py" orbit
}

main "$@"
