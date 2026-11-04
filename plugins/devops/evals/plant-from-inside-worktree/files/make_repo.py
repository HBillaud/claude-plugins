#!/usr/bin/env python3
"""Build a repository where planting a worktree the obvious way goes wrong.

The user works inside a worktree, so --show-toplevel points at the wrong place.
Local main is behind origin/main, and the current branch has unmerged commits, so
branching from HEAD or local main picks up the wrong base. Branches follow a
feature/ prefix, and .claude/worktrees/ is not ignored yet.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ENV = {
    **os.environ,
    "GIT_AUTHOR_NAME": "Dev",
    "GIT_AUTHOR_EMAIL": "dev@example.com",
    "GIT_COMMITTER_NAME": "Dev",
    "GIT_COMMITTER_EMAIL": "dev@example.com",
}


def git(cwd, *args) -> None:
    subprocess.run(["git", *args], cwd=str(cwd), check=True, capture_output=True, env=ENV)


def main(name: str) -> None:
    here = Path.cwd()
    origin = here / ".remotes" / "acme.git"
    origin.parent.mkdir()
    git(here, "init", "--bare", "-b", "main", str(origin))
    root = here / name
    git(here, "clone", str(origin), str(root))
    git(root, "checkout", "-b", "main")
    (root / "README.md").write_text("# acme\n")
    git(root, "add", ".")
    git(root, "commit", "-m", "Initial commit")
    git(root, "push", "-u", "origin", "main")
    git(root, "remote", "set-head", "origin", "main")
    for slug in ("add-billing", "add-search"):
        git(root, "branch", f"feature/{slug}")
        git(root, "push", "origin", f"feature/{slug}")

    # A teammate moves origin/main on; this clone has not fetched it.
    other = here / ".remotes" / "teammate"
    git(here, "clone", str(origin), str(other))
    (other / "CHANGELOG.md").write_text("Remote-only change\n")
    git(other, "add", ".")
    git(other, "commit", "-m", "Remote-only commit on main")
    git(other, "push", "origin", "main")

    current = root / ".claude" / "worktrees" / "add-search"
    git(root, "worktree", "add", str(current), "feature/add-search")
    (current / "search.txt").write_text("search\n")
    git(current, "add", ".")
    git(current, "commit", "-m", "Unmerged search work")


if __name__ == "__main__":
    main(sys.argv[1])
