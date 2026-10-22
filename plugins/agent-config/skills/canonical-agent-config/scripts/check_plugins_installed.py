#!/usr/bin/env python3
"""Claude Code SessionStart hook: name each plugin the project enables that this machine lacks.

A repository that moves its generic skills into a shared plugin relies on every
developer having installed it. A session without the plugin starts normally and
silently lacks those rules, so this hook says so: to the user as a system
message, and to the session as context, so the agent can mention it before
doing work that depends on them. It never blocks a session; when it cannot
check, it says that instead.

Wire it in the project's .claude/settings.json:

  "hooks": {"SessionStart": [{"hooks": [{"type": "command", "timeout": 10,
    "command": "python3 \\"$CLAUDE_PROJECT_DIR/scripts/agents/check_plugins_installed.py\\""}]}]}

Python 3.9+, standard library only.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def emit(user: str, context: str | None = None) -> None:
    out: dict = {"systemMessage": user}
    if context:
        out["hookSpecificOutput"] = {
            "hookEventName": "SessionStart",
            "additionalContext": context,
        }
    print(json.dumps(out))


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        payload = {}
    project = Path(
        os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or os.getcwd()
    )
    try:
        settings = json.loads(
            (project / ".claude" / "settings.json").read_text(encoding="utf-8")
        )
        enabled = [
            name
            for name, on in (settings.get("enabledPlugins") or {}).items()
            if on is True
        ]
    except (OSError, ValueError, AttributeError):
        return 0  # no project settings, nothing enabled: nothing to check
    if not enabled:
        return 0
    config_dir = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
    try:
        installed = json.loads(
            (config_dir / "plugins" / "installed_plugins.json").read_text(
                encoding="utf-8"
            )
        )
        have = set(installed.get("plugins") or {})
    except FileNotFoundError:
        have = set()
    except (OSError, ValueError, AttributeError) as exc:
        emit(
            f"Cannot check that the plugins this repository enables are installed ({exc}); "
            "their rules may be missing from this session."
        )
        return 0
    missing = sorted(set(enabled) - have)
    if missing:
        names = ", ".join(missing)
        emit(
            f"Plugins this repository enables but this machine has not installed: {names}. Their rules, "
            "skills and hooks are not in effect. Install each with `claude plugin install <plugin>@<marketplace>`, "
            "then restart.",
            f"Plugins not loaded: {names}. This repository relies on them; tell the user before doing work "
            "that depends on them.",
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
