#!/usr/bin/env bash
# Copies the operator's Playwright and its Chromium headless shell into the eval sandbox, so the
# agent can run check-responsive's runner there. Called by the cases' scaffold scripts.
#
# The sandbox the agent runs in can read neither the operator's node_modules nor their browser
# cache, and has no network to install them; the scaffold runs as the operator, before it starts.
# The scaffold's environment is reduced to PATH and a few basics, so Playwright is looked up in fixed
# places: NODE_PATH when it gets through, the global node_modules (npm root -g), then
# ~/.cache/design-studio/playwright (npm i --prefix ~/.cache/design-studio/playwright playwright).
# It is copied to <sandbox home>/node_modules, which run-matrix.mjs finds by walking up from the
# working directory, and the browser to the sandbox home's default Playwright cache.
# Without Playwright on the operator's machine it prints a note and does nothing: the agent then
# meets what a user without Playwright meets.
set -euo pipefail

provision_playwright() {
  local home="$1" mods="" rev cache src dest cp_flags="-R" real_home dir
  # $HOME here is already the sandbox's; the operator's is in the password database.
  real_home=$(python3 -c 'import os, pwd; print(pwd.getpwuid(os.getuid()).pw_dir)')
  for dir in $(echo "${NODE_PATH:-}" | tr ':' ' ') "$(npm root -g 2>/dev/null || true)" "$real_home/.cache/design-studio/playwright/node_modules"; do
    if [ -f "$dir/playwright/package.json" ] && [ -d "$dir/playwright-core" ]; then mods="$dir"; break; fi
  done
  if [ -z "$mods" ]; then
    echo "provision-playwright: playwright not found (npm i --prefix ~/.cache/design-studio/playwright playwright); the agent runs without it" >&2
    return 0
  fi
  rev=$(node -p 'require(process.argv[1]).browsers.find((b) => b.name === "chromium-headless-shell").revision' "$mods/playwright-core/browsers.json")

  # The operator's browser cache: Playwright's default under their real home.
  if [ "$(uname)" = "Darwin" ]; then
    cache="$real_home/Library/Caches/ms-playwright"
    dest="$home/Library/Caches/ms-playwright"
    cp_flags="-cR" # APFS clone: no copy of the 200 MB browser
  else
    cache="$real_home/.cache/ms-playwright"
    dest="$home/.cache/ms-playwright"
  fi
  src="$cache/chromium_headless_shell-$rev"
  if [ ! -d "$src" ]; then
    echo "provision-playwright: no $src (npx playwright install chromium); the agent runs without it" >&2
    return 0
  fi

  mkdir -p "$home/node_modules" "$dest"
  cp $cp_flags "$mods/playwright" "$mods/playwright-core" "$home/node_modules/"
  cp $cp_flags "$src" "$dest/"
  echo "provision-playwright: playwright and chromium_headless_shell-$rev copied into $home" >&2
}

# The case's working directory is the sandbox home's cwd/ folder.
provision_playwright "${1:-$(cd .. && pwd)}"
