#!/usr/bin/env bash
# Builds ./shop, the repository this case hands to the agent, and ./ISSUE-41.md.
set -euo pipefail

main() {
  python3 "$(dirname -- "$0")/files/make_repo.py" shop ISSUE-41.md
}

main "$@"
