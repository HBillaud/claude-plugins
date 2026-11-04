#!/usr/bin/env python3
"""Tests for prune_worktrees.py: run python3 test_prune_worktrees.py

Every case builds its own temporary repository, with a bare remote beside it,
and runs the script as a subprocess. The cases are the ways a worktree audit can
lose work or refuse for the wrong reason: an error read as "nothing found", a
commit that lives only in a submodule, an ignored file that exists nowhere else,
a lock, a process running inside, a stash that belongs to the whole repository.

Hermetic: no network, and git runs with no global or system configuration.
Python 3.9+.
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "prune_worktrees.py"
_failures = 0


def report(ok: bool, name: str, detail: str = "") -> None:
    global _failures
    print(f"{'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        _failures += 1
        if detail:
            print(detail)


def environment(extra_path: str = "") -> dict:
    env = dict(
        os.environ,
        GIT_CONFIG_GLOBAL=os.devnull,
        GIT_CONFIG_NOSYSTEM="1",
        GIT_AUTHOR_NAME="t",
        GIT_AUTHOR_EMAIL="t@example.com",
        GIT_COMMITTER_NAME="t",
        GIT_COMMITTER_EMAIL="t@example.com",
    )
    if extra_path:
        env["PATH"] = extra_path + os.pathsep + env["PATH"]
    return env


def git(cwd, *args) -> str:
    result = subprocess.run(
        ["git", "-c", "protocol.file.allow=always", *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
        env=environment(),
    )
    if result.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {result.stderr}")
    return result.stdout.strip()


class Repo:
    """A repository with an origin, on main, and a helper to plant worktrees."""

    def __init__(self, base: Path, label: str):
        self.base = base / label
        self.base.mkdir()
        self.remote = self.base / "origin.git"
        git(self.base, "init", "-q", "--bare", "-b", "main", str(self.remote))
        self.root = self.base / "repo"
        git(self.base, "clone", "-q", str(self.remote), str(self.root))
        (self.root / ".gitignore").write_text(
            ".claude/worktrees/\n.env.local\nnode_modules/\n"
        )
        (self.root / "a.txt").write_text("a\n")
        git(self.root, "checkout", "-q", "-b", "main")
        git(self.root, "add", ".")
        git(self.root, "commit", "-qm", "init")
        git(self.root, "push", "-q", "-u", "origin", "main")
        git(self.root, "remote", "set-head", "origin", "main")

    def path(self, name: str) -> Path:
        return self.root / ".claude" / "worktrees" / name

    def plant(self, name: str, branch: str = "") -> Path:
        path = self.path(name)
        git(self.root, "worktree", "add", "-q", "-b", branch or name, str(path), "main")
        return path

    def commit(self, name: str, text: str = "work") -> None:
        path = self.path(name)
        (path / f"{text}.txt").write_text(text)
        git(path, "add", ".")
        git(path, "commit", "-qm", text)

    def run(self, *args, cwd=None, path_prefix: str = ""):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), *args, "--json"],
            cwd=str(cwd or self.root),
            capture_output=True,
            text=True,
            env=environment(path_prefix),
        )
        try:
            payload = json.loads(result.stdout)
        except ValueError:
            payload = {}
        return result.returncode, payload, result.stdout + result.stderr

    def item(self, payload: dict, name: str) -> dict:
        return next(i for i in payload.get("worktrees", []) if i["name"] == name)


def codes(item: dict) -> set:
    return {b["code"] for b in item["blockers"]}


def check_blocked(repo: Repo, name: str, code: str, label: str) -> None:
    """Blocked in the audit, and still on disk after a removal that names it."""
    _, payload, out = repo.run("audit")
    report(code in codes(repo.item(payload, name)), f"audit blocks: {label}", out)
    rc, payload, out = repo.run("remove", "--only", name)
    report(rc == 1 and repo.path(name).exists(), f"remove leaves it: {label}", out)


def stub_gh(base: Path, body: str) -> str:
    directory = base / "stub-bin"
    directory.mkdir(exist_ok=True)
    script = directory / "gh"
    script.write_text(f"#!/bin/sh\ncat <<'JSON'\n{body}\nJSON\n")
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    return str(directory)


def main() -> int:
    with tempfile.TemporaryDirectory() as temporary:
        base = Path(os.path.realpath(temporary))

        # What may be removed, and what removal leaves behind.
        repo = Repo(base, "clean")
        repo.plant("done")
        repo.commit("done")
        git(repo.path("done"), "push", "-q", "-u", "origin", "done")
        rc, payload, out = repo.run("remove", "--only", "done")
        report(rc == 0 and not repo.path("done").exists(), "a clean pushed worktree is removed", out)
        report(git(repo.root, "rev-parse", "--verify", "done") != "", "its branch outlives it", out)

        repo = Repo(base, "unpushed")
        repo.plant("local")
        repo.commit("local")
        rc, payload, out = repo.run("remove", "--only", "local")
        facts = " ".join(repo.item(payload, "local")["facts"])
        report(rc == 0 and "only one" in facts, "an unpushed branch is removable and says it is the only copy", out)
        report(git(repo.root, "rev-parse", "--verify", "local") != "", "the unpushed branch survives", out)

        # The audit's blockers.
        repo = Repo(base, "dirty")
        (repo.plant("edited") / "a.txt").write_text("changed\n")
        check_blocked(repo, "edited", "dirty", "a modified tracked file")
        (repo.plant("untracked") / "new.txt").write_text("new\n")
        check_blocked(repo, "untracked", "dirty", "an untracked file")

        repo = Repo(base, "ignored")
        (repo.plant("secret") / ".env.local").write_text("KEY=only-here\n")
        check_blocked(repo, "secret", "ignored-files", "an ignored file found nowhere else")
        rc, payload, out = repo.run("remove", "--only", "secret", "--accept-ignored", "secret")
        report(rc == 0 and not repo.path("secret").exists(), "--accept-ignored lets the user release it", out)

        repo = Repo(base, "ignored-copy")
        (repo.root / ".env.local").write_text("KEY=same\n")
        (repo.plant("copied") / ".env.local").write_text("KEY=same\n")
        (repo.plant("drifted") / ".env.local").write_text("KEY=changed\n")
        modules = repo.plant("deps") / "node_modules"
        modules.mkdir()
        (modules / "x.js").write_text("x\n")
        _, payload, out = repo.run("audit")
        report(not repo.item(payload, "copied")["blockers"], "an ignored file identical to the primary's does not block", out)
        report("ignored-files" in codes(repo.item(payload, "drifted")), "an ignored file that differs from the primary's blocks", out)
        report(not repo.item(payload, "deps")["blockers"], "node_modules does not block", out)

        repo = Repo(base, "orphan")
        repo.path("loose").mkdir(parents=True)
        (repo.path("loose") / "notes.txt").write_text("work\n")
        check_blocked(repo, "loose", "not-registered", "a directory git does not know, even inside a clean repository")

        repo = Repo(base, "broken")
        path = repo.plant("gone")
        (path / "unsaved.txt").write_text("unsaved\n")
        shutil.rmtree(repo.root / ".git" / "worktrees" / "gone")
        check_blocked(repo, "gone", "not-registered", "a worktree whose metadata is gone, where git only errors")

        repo = Repo(base, "bad-gitfile")
        path = repo.plant("corrupt")
        (path / ".git").write_text("gitdir: /nonexistent/place\n")
        rc, payload, out = repo.run("audit")
        report(repo.item(payload, "corrupt")["blockers"] != [], "a corrupt .git file blocks instead of reading as clean", out)

        repo = Repo(base, "locked")
        repo.plant("agent")
        git(repo.root, "worktree", "lock", "--reason", "agent running", str(repo.path("agent")))
        check_blocked(repo, "agent", "locked", "a locked worktree")

        repo = Repo(base, "detached")
        path = repo.plant("lost")
        git(path, "checkout", "-q", "--detach")
        repo.commit("lost", "stray")
        check_blocked(repo, "lost", "orphan-commits", "a detached commit nothing contains")
        path = repo.plant("held")
        repo.commit("held", "kept")
        git(path, "checkout", "-q", "--detach")
        _, payload, out = repo.run("audit")
        report(not repo.item(payload, "held")["blockers"], "a detached commit a branch contains does not block", out)

        repo = Repo(base, "merge")
        path = repo.plant("merging")
        repo.commit("merging", "one")
        (repo.root / "b.txt").write_text("b\n")
        git(repo.root, "add", ".")
        git(repo.root, "commit", "-qm", "b")
        git(path, "merge", "--no-commit", "--no-ff", "main")
        check_blocked(repo, "merging", "in-progress", "an unfinished merge")

        repo = Repo(base, "nested")
        outer = repo.plant("outer")
        git(repo.root, "worktree", "add", "-q", "-b", "inner", str(outer / ".claude" / "worktrees" / "inner"), "main")
        check_blocked(repo, "outer", "contains-worktree", "a worktree holding another worktree")

        repo = Repo(base, "cwd")
        path = repo.plant("here")
        rc, payload, out = repo.run("remove", "--only", "here", cwd=path)
        report(
            rc == 1 and path.exists() and "current-directory" in codes(repo.item(payload, "here")),
            "the worktree this session is in is left alone",
            out,
        )

        if shutil.which("lsof"):
            repo = Repo(base, "process")
            path = repo.plant("busy")
            sleeper = subprocess.Popen(["sleep", "60"], cwd=str(path))
            try:
                check_blocked(repo, "busy", "in-use", "a worktree another process runs inside")
            finally:
                sleeper.kill()
                sleeper.wait()
        else:
            print("SKIP  a worktree another process runs inside (no lsof)")

        # Stashes belong to the whole repository.
        repo = Repo(base, "stash")
        repo.plant("clean")
        (repo.root / "a.txt").write_text("changed\n")
        git(repo.root, "stash", "-q")
        _, payload, out = repo.run("audit")
        report(not repo.item(payload, "clean")["blockers"], "a stash from the primary blocks nothing", out)
        (repo.path("clean") / "a.txt").write_text("mine\n")
        git(repo.path("clean"), "stash", "-q")
        rc, payload, out = repo.run("remove", "--only", "clean")
        facts = " ".join(repo.item(payload, "clean")["facts"])
        report(rc == 0 and "survive" in facts, "a stash from the branch is reported, not a blocker", out)
        report(git(repo.root, "stash", "list").count("WIP on clean") == 1, "and it survives the removal", out)

        # Submodules: their git directories live inside the worktree's admin directory.
        repo = Repo(base, "submodule")
        upstream = repo.base / "sub"
        git(repo.base, "init", "-q", "-b", "main", str(upstream))
        git(upstream, "commit", "-q", "--allow-empty", "-m", "s0")
        git(repo.root, "submodule", "--quiet", "add", str(upstream), "sm")
        git(repo.root, "commit", "-qm", "add sm")
        git(repo.root, "push", "-q", "origin", "main")
        for name in ("sm-commit", "sm-clean", "sm-dirty", "sm-stash"):
            git(repo.plant(name), "submodule", "--quiet", "update", "--init")
        git(repo.path("sm-commit") / "sm", "commit", "-q", "--allow-empty", "-m", "only copy")
        check_blocked(repo, "sm-commit", "submodule-commits", "a commit that exists only in a submodule")
        (repo.path("sm-dirty") / "sm" / "new.txt").write_text("new\n")
        check_blocked(repo, "sm-dirty", "submodule-dirty", "uncommitted work in a submodule")
        (repo.path("sm-stash") / "sm" / "new.txt").write_text("new\n")
        git(repo.path("sm-stash") / "sm", "stash", "-q", "-u")
        check_blocked(repo, "sm-stash", "submodule-stash", "a stash in a submodule")
        rc, payload, out = repo.run("remove", "--only", "sm-clean")
        report(rc == 0 and not repo.path("sm-clean").exists(), "a clean worktree with a submodule is removed despite git's refusal", out)
        listed = git(repo.root, "worktree", "list")
        report("sm-clean" not in listed, "and git's bookkeeping is pruned", listed)

        # Selection.
        repo = Repo(base, "select")
        for name in ("one", "two", "three"):
            repo.plant(name)
        rc, payload, out = repo.run("remove", "--only", "nope")
        report(rc == 2 and repo.path("one").exists(), "an unknown name stops everything", out)
        rc, payload, out = repo.run("remove")
        report(rc == 2 and repo.path("one").exists(), "remove with no selection stops everything", out)
        rc, payload, out = repo.run("audit")
        report(repo.path("one").exists() and repo.path("two").exists(), "audit removes nothing", out)
        rc, payload, out = repo.run("remove", "--only", "ONE")
        report(rc == 0 and not repo.path("one").exists() and repo.path("two").exists(), "--only removes just the named one, ignoring case", out)
        rc, payload, out = repo.run("remove", "--keep", "two")
        report(rc == 0 and repo.path("two").exists() and not repo.path("three").exists(), "--keep removes all the others", out)

        repo = Repo(base, "from-inside")
        inner = repo.plant("alpha")
        repo.plant("beta")
        _, payload, out = repo.run("audit", cwd=inner)
        report(
            payload.get("root") == str(repo.root) and {i["name"] for i in payload["worktrees"]} == {"alpha", "beta"},
            "run from inside a worktree, it still finds the primary checkout",
            out,
        )

        # --merged.
        repo = Repo(base, "merged")
        for name in ("landed", "open", "fresh", "renamed", "squashed", "moved-on"):
            repo.plant(name)
        repo.commit("landed", "landed")
        git(repo.root, "merge", "-q", "--no-ff", "-m", "merge", "landed")
        git(repo.root, "push", "-q", "origin", "main")
        repo.commit("open", "open")
        git(repo.path("renamed"), "branch", "-m", "renamed", "feature/renamed")
        repo.commit("squashed", "squashed")
        repo.commit("moved-on", "moved-on")
        squashed = git(repo.path("squashed"), "rev-parse", "HEAD")
        gh = stub_gh(base, json.dumps([{"headRefOid": squashed}]))
        rc, payload, out = repo.run("remove", "--merged", path_prefix=gh)
        report(rc == 0 and not repo.path("landed").exists(), "--merged removes a merged branch", out)
        report(not repo.path("squashed").exists(), "--merged removes a squash-merged branch via its PR's SHA", out)
        report(repo.path("moved-on").exists(), "--merged keeps a branch whose SHA differs from the merged PR's", out)
        report(repo.path("open").exists(), "--merged keeps an unmerged branch", out)
        report(repo.path("fresh").exists(), "--merged keeps a freshly planted worktree with no commits", out)
        report(repo.path("renamed").exists(), "--merged keeps a fresh worktree whose branch was renamed", out)

        repo = Repo(base, "remote-deleted")
        path = repo.plant("shipped")
        repo.commit("shipped", "shipped")
        git(path, "push", "-q", "-u", "origin", "shipped")
        git(path, "push", "-q", "origin", "--delete", "shipped")
        shipped = git(path, "rev-parse", "HEAD")
        rc, payload, out = repo.run("audit", "--merged", path_prefix=stub_gh(base, json.dumps([{"headRefOid": shipped}])))
        item = repo.item(payload, "shipped")
        report(not item["blockers"], "a remote branch deleted after its merge does not block", out)
        report(item["merge_state"] == "merged-pr" and item["selected"], "and --merged still selects it", out)
        report("only one" in " ".join(item["facts"]), "and it says the local branch is the only copy", out)

        repo = Repo(base, "no-gh")
        repo.plant("squash")
        repo.commit("squash")
        rc, payload, out = repo.run("remove", "--merged", "--keep", "squash")
        report(rc == 0 and repo.path("squash").exists(), "--merged honours --keep", out)

        # Outside a repository.
        outside = base / "plain"
        outside.mkdir()
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "audit", "--repo", str(outside)],
            capture_output=True,
            text=True,
            env=environment(),
        )
        report(result.returncode == 2 and "Traceback" not in result.stderr, "outside a repository it exits 2", result.stderr)

    print(f"\n{_failures} failing case(s)" if _failures else "\nAll cases passed")
    return 1 if _failures else 0


if __name__ == "__main__":
    sys.exit(main())
