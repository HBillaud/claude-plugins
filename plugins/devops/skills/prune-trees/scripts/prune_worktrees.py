#!/usr/bin/env python3
"""Audit and remove the worktrees under a repository's .claude/worktrees/.

  prune_worktrees.py audit  [--keep NAME... | --only NAME... | --merged] [--repo PATH] [--json]
  prune_worktrees.py remove (--keep NAME... | --only NAME... | --merged)
                            [--accept-ignored NAME...] [--repo PATH] [--json]

`audit` changes nothing. `remove` audits every candidate again immediately
before deleting it and deletes only what passes. Branches are never deleted.

The audit fails closed. A git command that errors blocks the worktree instead of
reading as "nothing found", because an empty result from a failed command looks
exactly like a clean tree.

Exit codes: 0 done; 1 a candidate is blocked or could not be removed; 2 nothing
was done (not a repository, an unknown name, or no way to decide what is merged).

Python 3.9+, git 2.20+. `lsof` and `gh` are optional: without `lsof` the check for
other processes is skipped and reported; without `gh` squash merges go undetected.
"""

from __future__ import annotations

import argparse
import filecmp
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

WORKTREES_DIR = Path(".claude") / "worktrees"

# Ignored paths a fresh checkout can rebuild. Anything else ignored, such as .env.local,
# may exist nowhere else and blocks removal, unless the primary checkout holds the same bytes.
DISPOSABLE_NAMES = {
    ".DS_Store",
    ".cache",
    ".gradle",
    ".mypy_cache",
    ".next",
    ".nuxt",
    ".parcel-cache",
    ".pytest_cache",
    ".ruff_cache",
    ".svelte-kit",
    ".turbo",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
    "target",
    "venv",
}
IN_PROGRESS = {
    "rebase-merge": "rebase",
    "rebase-apply": "rebase or am",
    "MERGE_HEAD": "merge",
    "CHERRY_PICK_HEAD": "cherry-pick",
    "REVERT_HEAD": "revert",
    "BISECT_LOG": "bisect",
}
SUBMODULE_REFUSAL = "working trees containing submodules cannot be moved or removed"
FRESH_REFLOG_PREFIXES = ("branch: Created from", "Branch: renamed")
LISTED = 5  # paths named in one blocker before the rest are counted


class Unverified(Exception):
    """A git command failed, so its check proved nothing."""


class Stop(Exception):
    """Nothing can safely be done: exit 2."""


def git_env() -> dict:
    env = dict(os.environ, LC_ALL="C", GIT_OPTIONAL_LOCKS="0")
    # Inside a git hook these would point every command at the wrong repository.
    for name in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"):
        env.pop(name, None)
    return env


def run_git(cwd, *args) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(cwd), *args],
        capture_output=True,
        text=True,
        errors="replace",
        env=git_env(),
    )


def must(cwd, *args) -> str:
    result = run_git(cwd, *args)
    if result.returncode != 0:
        reason = result.stderr.strip() or f"exit {result.returncode}"
        raise Unverified(f"git {' '.join(args)}: {reason}")
    return result.stdout


def real(path) -> str:
    return os.path.realpath(str(path))


def inside(path: str, parent: str) -> bool:
    return path == parent or path.startswith(parent.rstrip(os.sep) + os.sep)


def parse_worktree_list(text: str) -> list:
    entries, entry = [], {}
    for line in text.splitlines():
        if not line:
            if entry:
                entries.append(entry)
            entry = {}
            continue
        key, _, value = line.partition(" ")
        entry[key] = value
    if entry:
        entries.append(entry)
    for item in entries:
        item["worktree"] = real(item["worktree"])
    return entries


def list_worktrees(start) -> list:
    result = run_git(start, "worktree", "list", "--porcelain")
    if result.returncode != 0:
        raise Stop(f"{start} is not inside a git repository: {result.stderr.strip()}")
    return parse_worktree_list(result.stdout)


def default_base(root: str):
    result = run_git(root, "symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD")
    if result.returncode == 0 and result.stdout.strip():
        return result.stdout.strip()
    for ref in ("origin/main", "origin/master", "main", "master"):
        if run_git(root, "rev-parse", "-q", "--verify", ref).returncode == 0:
            return ref
    return None


def size_kb(path):
    try:
        result = subprocess.run(
            ["du", "-sk", str(path)], capture_output=True, text=True, errors="replace"
        )
        return int(result.stdout.split()[0])
    except (OSError, ValueError, IndexError):
        return None


def process_cwds():
    """Every other process's working directory, or None when that cannot be read."""
    if not shutil.which("lsof"):
        return None
    try:
        result = subprocess.run(
            ["lsof", "-n", "-w", "-d", "cwd", "-Fpn"],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    found, pid = [], None
    for line in result.stdout.splitlines():
        if line.startswith("p"):
            pid = int(line[1:])
        elif line.startswith("n") and pid not in (None, os.getpid()):
            found.append((pid, real(line[1:])))
    return found


def named(paths: list) -> str:
    shown = ", ".join(paths[:LISTED])
    return shown if len(paths) <= LISTED else f"{shown} and {len(paths) - LISTED} more"


def undisposable_ignored(directory, primary) -> list:
    """Ignored paths in `directory` that a removal would lose for good."""
    output = must(directory, "status", "--porcelain", "-z", "--ignored=matching")
    lost = []
    for record in output.split("\0"):
        if not record.startswith("!! "):
            continue
        relative = record[3:].rstrip("/")
        parts = Path(relative).parts
        if any(p in DISPOSABLE_NAMES for p in parts) or relative.endswith(".pyc"):
            continue
        ours, theirs = Path(directory) / relative, Path(primary) / relative
        if (
            ours.is_file()
            and theirs.is_file()
            and filecmp.cmp(str(ours), str(theirs), shallow=False)
        ):
            continue  # a copy planted from the primary checkout
        lost.append(relative)
    return lost


def audit_submodules(path: str, primary: str, block) -> None:
    for line in must(path, "submodule", "status", "--recursive").splitlines():
        if not line or line[0] == "-":
            continue  # not initialised: nothing of it lives here
        fields = line[1:].split()
        if len(fields) < 2:
            raise Unverified(f"unreadable submodule status: {line}")
        relative = fields[1]
        directory = os.path.join(path, relative)
        # A submodule's git directory lives inside the worktree's admin directory, so
        # unlike a branch of the worktree itself, none of this survives the removal.
        if must(directory, "status", "--porcelain"):
            block("submodule-dirty", f"{relative} has uncommitted changes")
        if must(directory, "stash", "list"):
            block("submodule-stash", f"{relative} has stashes that exist only here")
        local = must(directory, "rev-list", "--all", "HEAD", "--not", "--remotes")
        if local.strip():
            count = len(local.split())
            block(
                "submodule-commits",
                f"{relative} has {count} commit(s) on no remote, and the only copy is here",
            )
        lost = undisposable_ignored(directory, os.path.join(primary, relative))
        if lost:
            block("submodule-ignored", f"{relative}: {named(lost)}")


def merge_state(path: str, root: str, branch, head: str, base, ask_github: bool) -> str:
    if not branch or not base:
        return "unknown"
    reflog = run_git(root, "reflog", "show", f"refs/heads/{branch}", "--format=%gs")
    worked_on = reflog.returncode == 0 and any(
        line and not line.startswith(FRESH_REFLOG_PREFIXES)
        for line in reflog.stdout.splitlines()
    )
    if not worked_on:
        return "no-commits"  # planted and never used, which is not the same as merged
    if run_git(root, "merge-base", "--is-ancestor", head, base).returncode == 0:
        return "merged"
    if ask_github and shutil.which("gh"):
        try:
            result = subprocess.run(
                ["gh", "pr", "list", "--head", branch, "--state", "merged"]
                + ["--json", "headRefOid", "--limit", "20"],
                cwd=root,
                capture_output=True,
                text=True,
                errors="replace",
                timeout=30,
            )
            # Compared by SHA, so a commit added after the merge keeps it unmerged.
            if result.returncode == 0 and any(
                pr.get("headRefOid") == head for pr in json.loads(result.stdout)
            ):
                return "merged-pr"
        except (OSError, subprocess.TimeoutExpired, ValueError):
            return "unknown"
    return "unmerged"


def audit_one(path: str, ctx: dict) -> dict:
    root, entries = ctx["root"], ctx["entries"]
    item = {
        "name": os.path.basename(path),
        "path": path,
        "branch": None,
        "head": None,
        "merge_state": "unknown",
        "size_kb": size_kb(path),
        "blockers": [],
        "facts": [],
    }

    def block(code: str, detail: str) -> None:
        item["blockers"].append({"code": code, "detail": detail})

    entry = next((e for e in entries if e["worktree"] == path), None)
    if entry is None:
        # git -C here would fall through to the enclosing repository and audit that instead.
        block(
            "not-registered",
            "git does not list this directory as a worktree, so nothing about it can be verified",
        )
        return item

    item["head"] = entry.get("HEAD")
    if "branch" in entry:
        item["branch"] = entry["branch"].replace("refs/heads/", "", 1)
    if "locked" in entry:
        reason = entry["locked"] or "no reason given"
        block("locked", f"locked ({reason}); a running agent may be using it")

    try:
        here = real(os.getcwd())
    except OSError:
        here = ""
    if here and inside(here, path):
        block("current-directory", "this session is working inside it")
    if ctx["cwds"] is None:
        item["facts"].append("other processes not checked (lsof unavailable)")
    else:
        users = sorted({pid for pid, cwd in ctx["cwds"] if inside(cwd, path)})
        if users:
            block(
                "in-use",
                f"process(es) {', '.join(map(str, users))} are running inside it",
            )
    nested = [
        e["worktree"]
        for e in entries
        if e["worktree"] != path and inside(e["worktree"], path)
    ]
    if nested:
        block("contains-worktree", f"another worktree lives inside it: {named(nested)}")

    try:
        toplevel = must(path, "rev-parse", "--show-toplevel").strip()
        if real(toplevel) != path:
            raise Unverified(f"git resolves it to {toplevel}")

        for marker, operation in IN_PROGRESS.items():
            found = must(path, "rev-parse", "--git-path", marker).strip()
            if os.path.exists(os.path.join(path, found)):
                block("in-progress", f"a {operation} is unfinished")

        changed = [r for r in must(path, "status", "--porcelain", "-z").split("\0") if r]
        if changed:
            block("dirty", named([r[3:] for r in changed]))

        lost = undisposable_ignored(path, root)
        if lost:
            if item["name"].lower() in ctx["accept_ignored"]:
                item["facts"].append(f"ignored files accepted as disposable: {named(lost)}")
            else:
                block("ignored-files", f"ignored, and found nowhere else: {named(lost)}")

        audit_submodules(path, root, block)

        head = must(path, "rev-parse", "HEAD").strip()
        item["head"] = head
        branch = item["branch"]
        if branch:
            upstream = must(
                path, "for-each-ref", "--format=%(upstream:short)", f"refs/heads/{branch}"
            ).strip()
            # A merged PR usually deletes its remote branch, and git keeps naming it as the upstream.
            candidates = [ref for ref in (upstream, f"origin/{branch}") if ref]
            upstream = next(
                (ref for ref in candidates if run_git(path, "rev-parse", "-q", "--verify", ref).returncode == 0),
                "",
            )
            if not upstream:
                item["facts"].append(f"branch {branch} has no remote copy; the local branch is the only one")
            else:
                ahead = int(must(path, "rev-list", "--count", f"{upstream}..{branch}").strip())
                if ahead:
                    item["facts"].append(f"branch {branch} is {ahead} commit(s) ahead of {upstream}; the local branch is the only copy of them")
            # Stashes are shared by every worktree of a repository, so they survive a removal.
            pattern = re.compile(rf"^(WIP on|On) {re.escape(branch)}:")
            stashes = [s for s in must(path, "stash", "list", "--format=%gs").splitlines() if pattern.match(s)]
            if stashes:
                item["facts"].append(f"{len(stashes)} stash(es) made on {branch} survive the removal")
        else:
            orphaned = must(path, "rev-list", "HEAD", "--not", "--branches", "--remotes", "--tags")
            if orphaned.strip():
                block(
                    "orphan-commits",
                    f"detached at {head[:8]} with {len(orphaned.split())} commit(s) no branch, tag or remote contains",
                )
        item["merge_state"] = merge_state(path, root, branch, head, ctx["base"], ctx["ask_github"])
    except Unverified as exc:
        block("could-not-verify", str(exc))
    return item


def split_names(values) -> list:
    names = []
    for value in values or []:
        names.extend(n for n in re.split(r"[,\s]+", value) if n)
    return [os.path.basename(n.rstrip("/")).lower() for n in names]


def build_context(args) -> dict:
    entries = list_worktrees(args.repo)
    root = entries[0]["worktree"]  # git always lists the primary checkout first
    base_dir = Path(root) / WORKTREES_DIR
    directories = []
    if base_dir.is_dir():
        directories = sorted(
            real(p) if not p.is_symlink() else str(p)
            for p in base_dir.iterdir()
            if p.is_dir()
        )
    ask_github = bool(getattr(args, "merged", False))
    base = default_base(root)
    if ask_github and base is None:
        raise Stop("--merged needs a default branch to compare with, and none resolved")
    return {
        "root": root,
        "entries": entries,
        "directories": directories,
        "base": base,
        "ask_github": ask_github,
        "cwds": process_cwds(),
        "accept_ignored": set(split_names(getattr(args, "accept_ignored", None))),
    }


def choose(args, audited: list) -> None:
    names = {i["name"].lower() for i in audited}
    keep, only = split_names(args.keep), split_names(args.only)
    unknown = sorted(set(keep + only) - names)
    if unknown:
        raise Stop(f"no worktree named {', '.join(unknown)}; nothing was done")
    for item in audited:
        lowered = item["name"].lower()
        if args.only:
            item["selected"] = lowered in only
        elif args.merged:
            item["selected"] = lowered not in keep and item["merge_state"] in ("merged", "merged-pr")
        else:
            item["selected"] = lowered not in keep
        item["kept"] = lowered in keep


def remove_one(item: dict, root: str) -> str:
    """Remove a worktree that just passed the audit. Returns an error, or an empty string."""
    # Never --force: git refusing on a dirty or locked tree is the last line of defence.
    result = run_git(root, "worktree", "remove", item["path"])
    if result.returncode == 0:
        return ""
    if SUBMODULE_REFUSAL not in result.stderr:
        return result.stderr.strip() or f"git worktree remove exited {result.returncode}"
    # A blanket rule of git's, not a verdict on this tree. The audit already covered its submodules.
    try:
        shutil.rmtree(item["path"])
    except OSError as exc:
        return f"could not delete the directory: {exc}"
    return ""


def stale_registrations(ctx: dict) -> list:
    base = real(Path(ctx["root"]) / WORKTREES_DIR)
    return [
        e["worktree"]
        for e in ctx["entries"]
        if inside(e["worktree"], base) and not os.path.isdir(e["worktree"])
    ]


def report(payload: dict, as_json: bool) -> None:
    if as_json:
        print(json.dumps(payload, indent=2))
        return
    print(f"repository: {payload['root']}")
    if not payload["worktrees"]:
        print(f"no worktrees under {WORKTREES_DIR}")
    for item in payload["worktrees"]:
        size = "?" if item["size_kb"] is None else f"{item['size_kb'] / 1024:.1f} MB"
        if item.get("removed"):
            verdict = "removed"
        elif item.get("kept"):
            verdict = "kept (asked)"
        elif item["blockers"]:
            verdict = "BLOCKED"
        elif item.get("error"):
            verdict = "FAILED"
        else:
            verdict = "removable" if item.get("selected", True) else "not selected"
        where = item["branch"] or (f"detached {item['head'][:8]}" if item["head"] else "no branch")
        print(f"- {item['name']}: {verdict} | {where} | {size} | {item['merge_state']}")
        for blocker in item["blockers"]:
            print(f"    blocked, {blocker['code']}: {blocker['detail']}")
        for fact in item["facts"]:
            print(f"    note: {fact}")
        if item.get("error"):
            print(f"    error: {item['error']}")
    for path in payload["stale_registrations"]:
        print(f"- stale registration, directory already gone: {path}")
    if "total_kb_before" in payload:
        print(f"disk: {payload['total_kb_before']} KB -> {payload['total_kb_after']} KB")
    for line in payload.get("branches_after", []):
        print(f"branch kept: {line}")
    for line in payload.get("pruned", []):
        print(f"git worktree prune: {line}")


def command_audit(args) -> int:
    ctx = build_context(args)
    audited = [audit_one(path, ctx) for path in ctx["directories"]]
    choose(args, audited)
    payload = {
        "root": ctx["root"],
        "base": ctx["base"],
        "worktrees": audited,
        "stale_registrations": stale_registrations(ctx),
        "total_kb": size_kb(Path(ctx["root"]) / WORKTREES_DIR),
    }
    report(payload, args.json)
    return 0


def command_remove(args) -> int:
    if not (args.keep or args.only or args.merged):
        raise Stop("remove needs --keep, --only or --merged; nothing was done")
    ctx = build_context(args)
    audited = [audit_one(path, ctx) for path in ctx["directories"]]
    choose(args, audited)
    before = size_kb(Path(ctx["root"]) / WORKTREES_DIR)
    failed, branches = False, []
    for item in audited:
        if not item["selected"]:
            continue
        if item["blockers"]:
            failed = True
            continue
        # Audited again here: something may have started using it since the first pass.
        ctx["entries"] = list_worktrees(ctx["root"])
        ctx["cwds"] = process_cwds()
        fresh = audit_one(item["path"], ctx)
        if fresh["blockers"]:
            item["blockers"] = fresh["blockers"]
            failed = True
            continue
        error = remove_one(item, ctx["root"])
        if error:
            item["error"] = error
            failed = True
            continue
        item["removed"] = True
        if item["branch"]:
            exists = run_git(ctx["root"], "rev-parse", "-q", "--verify", f"refs/heads/{item['branch']}")
            branches.append(f"{item['branch']} at {exists.stdout.strip()[:8]}" if exists.returncode == 0 else f"{item['branch']} MISSING")
    stale = stale_registrations(dict(ctx, entries=list_worktrees(ctx["root"])))
    pruned = must(ctx["root"], "worktree", "prune", "-v").splitlines()
    payload = {
        "root": ctx["root"],
        "base": ctx["base"],
        "worktrees": audited,
        "stale_registrations": stale,
        "total_kb_before": before,
        "total_kb_after": size_kb(Path(ctx["root"]) / WORKTREES_DIR),
        "branches_after": branches,
        "pruned": pruned,
    }
    report(payload, args.json)
    return 1 if failed else 0


def parser() -> argparse.ArgumentParser:
    top = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = top.add_subparsers(dest="command", required=True)
    for name, handler in (("audit", command_audit), ("remove", command_remove)):
        sub = commands.add_parser(name)
        sub.set_defaults(handler=handler)
        sub.add_argument("--repo", default=".", help="any directory of the repository (default: here)")
        sub.add_argument("--json", action="store_true")
        sub.add_argument("--keep", nargs="+", metavar="NAME", help="every worktree except these")
        sub.add_argument("--only", nargs="+", metavar="NAME", help="just these worktrees")
        sub.add_argument("--merged", action="store_true", help="worktrees whose work is merged; combines with --keep")
        if name == "remove":
            sub.add_argument(
                "--accept-ignored",
                nargs="+",
                metavar="NAME",
                help="these worktrees' ignored files may be lost: only after the user has seen the list and agreed",
            )
    return top


def main() -> int:
    args = parser().parse_args()
    if args.only and (args.keep or args.merged):
        print("--only cannot combine with --keep or --merged", file=sys.stderr)
        return 2
    try:
        return args.handler(args)
    except (Stop, Unverified) as exc:
        print(f"prune_worktrees: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
