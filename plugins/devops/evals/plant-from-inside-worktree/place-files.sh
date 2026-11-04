#!/usr/bin/env bash
# Builds ./acme, with the user's current worktree inside it.
set -euo pipefail

main() {
  python3 "$(dirname -- "$0")/files/make_repo.py" acme
}

main "$@"
