#!/usr/bin/env bash
# Builds ./acme, the repository this case hands to the agent, with its worktrees.
set -euo pipefail

main() {
  python3 "$(dirname -- "$0")/files/make_repo.py" acme
}

main "$@"
