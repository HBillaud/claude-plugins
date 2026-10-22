#!/usr/bin/env python3
"""Build the messy repository this eval hands to the agent: python3 make_messy_repo.py <new-dir>

Seeded with the defects the skill must clear, plus three facts that exist in one
copy only (they must survive) and one conflict between copies (it must be reported):
  - only in .cursorrules: "Never commit generated files under `dist/`."
  - only in GEMINI.md:    "Database migrations live in `db/migrations/` and are append-only."
  - only in web/CLAUDE.md: "The web app's API base URL comes from `VITE_API_URL`."
  - conflict: CLAUDE.md says `pnpm test`, .cursorrules says `npm test` (package.json uses pnpm).

The broken skill citation and the home-directory path it seeds are assembled from
parts, so this file never reads as either to a guard scanning the skill that ships it.
Python 3.9+, standard library only; needs git, and ignores the user's git configuration.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

OLD_HELPER = ".claude/" + "skills/old-helper/SKILL.md"
PUBLISH = "/Users/" + "jdoe/bin/publish.sh"


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def skill(path: Path, name: str, description: str, body: str) -> None:
    write(
        path / "SKILL.md",
        f"---\nname: {name}\ndescription: {description}\n---\n\n{body}",
    )


def main() -> int:
    root = Path(sys.argv[1]).resolve()
    if root.exists():
        print(f"{root} exists", file=sys.stderr)
        return 2

    write(
        root / "package.json",
        json.dumps(
            {
                "name": "orbit",
                "private": True,
                "packageManager": "pnpm@10.4.0",
                "scripts": {"test": "vitest run", "build": "vite build"},
            },
            indent=2,
        ),
    )
    write(root / "app" / "main.py", "def main() -> None:\n    print('orbit api')\n")
    write(root / "web" / "src" / "index.ts", "export const ready = true;\n")
    write(
        root / "db" / "migrations" / "0001_init.sql",
        "create table account (id bigint primary key);\n",
    )
    write(root / ".gitignore", "node_modules/\ndist/\n.venv/\n")

    write(
        root / "CLAUDE.md",
        f"""# CLAUDE.md

Orbit is a Python API (`app/`) with a TypeScript web client (`web/`).

## History

In March we moved from Flask to FastAPI after the outage on the 14th; before that the API
lived in `server/`. Ask Dana if you need the old deploy notes.

## Build and test

- Install: `uv sync` for the API, `pnpm install` for the web client.
- Run the API tests with `uv run pytest -q`.
- Run the web tests with `pnpm test`.
- Format Python with `uv run ruff format`; the CI rejects unformatted code.
- Tests run with `TEST_WORKERS=4` workers.

## Conventions

- Python functions are `snake_case`; TypeScript functions are `camelCase`.
- Every API route has a pydantic request model.
- Never use `print` in the API; use the `logging` module.

## Skills available

- `python-style` for Python conventions
- `release-procedure` for cutting a release
- `api-docs` for writing API documentation
- `changelog` for the changelog
- `web-testing` for the web tests (lives in web/)

See `{OLD_HELPER}` for the old helper.

## Claude Code hooks

The PostToolUse hook in `.claude/settings.json` runs ruff after every edit.
Never run `sudo` and never install packages globally.
""",
    )
    write(
        root / ".cursorrules",
        """Orbit is a Python API (`app/`) with a TypeScript web client (`web/`).

- Install: `uv sync` for the API, `pnpm install` for the web client.
- Run the API tests with `uv run pytest -q`.
- Run the web tests with `npm test`.
- Python functions are `snake_case`; TypeScript functions are `camelCase`.
- Every API route has a pydantic request model.
- Never commit generated files under `dist/`.
""",
    )
    write(
        root / "GEMINI.md",
        """# Orbit

Orbit is a Python API (`app/`) with a TypeScript web client (`web/`).

- Run the API tests with `uv run pytest -q`.
- Every API route has a pydantic request model.
- Database migrations live in `db/migrations/` and are append-only.
""",
    )

    skills = root / ".claude" / "skills"
    skill(
        skills / "python-style",
        "python-style",
        "Python conventions for the Orbit API. Use when writing or reviewing Python in app/.",
        "# Python style\n\n- Type every function.\n- Prefer dataclasses for values.\n"
        "- Use `logging`, never `print`.\n",
    )
    skill(
        skills / "release",
        "release-procedure",
        "Cut an Orbit release. Use when asked to release, tag or publish a version.",
        "# Release\n\n1. Update `CHANGELOG.md` with the changelog skill.\n2. Tag `vX.Y.Z`.\n"
        f"3. Run `{PUBLISH}` to upload the build.\n",
    )
    skill(
        skills / "docs" / "api-docs",
        "api-docs",
        "Write API documentation for Orbit routes. Use when documenting an endpoint.",
        "# API docs\n\nDocument each route's request model, response and errors.\n"
        "See [the changelog skill](../changelog/SKILL.md) for release notes.\n",
    )
    skill(
        skills / "docs" / "changelog",
        "changelog",
        "Maintain CHANGELOG.md. Use when a change needs a changelog entry.",
        "# Changelog\n\nOne line per user-visible change, under Unreleased, newest first.\n",
    )

    skill(
        root / "web" / ".claude" / "skills" / "testing",
        "testing",
        "How to write and run the web client's tests. Use when touching web/ tests.",
        "# Web testing\n\n- Tests use vitest and live beside the code as `*.test.ts`.\n"
        "- Run them with `pnpm test` from `web/`.\n",
    )
    write(
        root / "web" / "CLAUDE.md",
        """# Web client

TypeScript, Vite, vitest.

- The web app's API base URL comes from `VITE_API_URL`.
- Components live in `web/src/components/`, one per file.
- Run `pnpm test` from `web/`.
""",
    )
    write(root / "web" / ".gitignore", "AGENTS.md\n*.log\n")

    write(
        root / ".claude" / "agents" / "reviewer.md",
        """---
name: reviewer
description: Reviews a diff against Orbit's conventions. Use before opening a pull request.
tools: Read, Grep, Glob, Bash
---

You review a diff for the Orbit repository.

1. Run `git diff main...HEAD` to see the change.
2. For each Python file, check every function is typed.
3. Check every API route has a pydantic request model.
4. Check no `print` call was added to `app/`.
5. For each TypeScript file, check functions are camelCase.
6. Check new components live in `web/src/components/`, one per file.
7. Check the changelog has an entry under Unreleased for user-visible changes.
8. Check no file under `dist/` is committed.
9. Check database migrations were only added, never edited.
10. Run `uv run pytest -q` and report failures.
11. Run `pnpm test` and report failures.
12. Report findings ranked: correctness first, then conventions, then style.
13. For each finding give the file, the line and the fix.
14. If nothing is wrong, say so plainly.
15. Never edit files yourself.
""",
    )
    write(
        root / ".claude" / "commands" / "deploy.md",
        "Deploy Orbit to staging: run `make deploy-staging`, then check `https://staging.orbit.example/health`.\n",
    )
    write(
        root / ".claude" / "settings.json",
        json.dumps(
            {
                "env": {"TEST_WORKERS": "4"},
                "permissions": {"deny": ["Bash(sudo *)", "Bash(npm install -g *)"]},
                "hooks": {
                    "PostToolUse": [
                        {
                            "matcher": "Edit|Write",
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": "uv run ruff format --quiet",
                                }
                            ],
                        }
                    ]
                },
            },
            indent=2,
        ),
    )
    write(
        root / ".claude" / "settings.local.json",
        json.dumps({"permissions": {"allow": ["Bash(make deploy-staging)"]}}, indent=2),
    )

    env = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1")
    for args in (
        ["init", "-q", "-b", "main"],
        ["add", "-A"],
        ["add", "-f", ".claude/settings.local.json"],
        [
            "-c",
            "user.email=dev@orbit.example",
            "-c",
            "user.name=dev",
            "commit",
            "-q",
            "-m",
            "Orbit before the agent-config migration",
        ],
    ):
        subprocess.run(
            ["git", "-C", str(root), *args], check=True, capture_output=True, env=env
        )
    print(root)
    return 0


if __name__ == "__main__":
    sys.exit(main())
