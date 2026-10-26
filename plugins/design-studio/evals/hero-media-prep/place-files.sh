#!/usr/bin/env bash
# Builds ./lumpia: the site, plus the raw hero clip and the new portrait in ./lumpia/incoming. Needs ffmpeg.
set -euo pipefail

main() {
  python3 "$(dirname -- "$0")/files/make_site.py" lumpia
}

main "$@"
