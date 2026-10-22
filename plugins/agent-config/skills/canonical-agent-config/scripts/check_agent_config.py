#!/usr/bin/env python3
"""Assert a repository's agent configuration: one canonical source, thin adapters.

Coding agents disagree about where they look. Claude Code reads CLAUDE.md and
.claude/; Codex, Antigravity and most other agents read AGENTS.md and the
neutral .agents/. The layout that survives that without copies is one real tree
plus adapters that point at it: AGENTS.md holds the instructions and each
CLAUDE.md is a relative symlink to it or a stub importing it; .agents/skills
holds the real skill directories and .claude/skills is a relative symlink to
them.

None of that shows in a review. A symlink replaced by a copy in a merge, a
skill renamed in its frontmatter but not on disk, an AGENTS.md that a
.gitignore swallows, or an instruction file grown past the size an agent
truncates at all read as ordinary diffs, so this script checks them.

Copy this file and test_check_agent_config.py into the repository (for example
scripts/agents/), set the CONFIGURATION block to the repository's decisions,
and run it in CI on every push as well as every pull request: the invariant is
whole-tree, and a merge commit can break it with no pull-request diff to show.

Modes:
  --mode audit    For the tree before or during the migration. Fails only on
                  what is broken in any layout: a SKILL.md without a name or a
                  description, two skills in one root answering to one name, a
                  dangling or escaping symlink in the agent configuration, an
                  instruction file git ignores, an AGENTS.md that imports
                  itself, a subagent preloading a skill that does not exist, a
                  settings file that is not a JSON object. Every other rule is
                  a warning: the migration's to-do list.
  --mode enforce  Every rule is a failure except home-paths and chain, which
                  stay warnings because their remedy is a judgment. The default.

--config FILE overrides CONFIGURATION names from a JSON object, for a
repository that keeps its decisions out of the script.

Exclusions are printed on every run: a silent exemption rots, a printed one
gets noticed.

Exit 0 when the layout holds, 1 when a rule fails, 2 when the check cannot
run. Python 3.9+, standard library only, so it runs on a bare CI runner and on
the python3 that macOS ships.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import subprocess
import sys
import urllib.parse
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

# ---- CONFIGURATION -----------------------------------------------------------
# The repository's decisions. Each is printed when it applies.

# The instruction file every agent reads, at the root and in any component.
CANONICAL_INSTRUCTIONS = "AGENTS.md"

# Per-agent instruction files allowed only as adapters: file name -> the import
# line a stub must hold. An adapter is either a relative symlink to its
# canonical file or a stub of at most STUB_MAX_LINES lines holding that import.
# Its canonical file is the AGENTS.md beside it, or for one inside a
# dot-directory (.github/...) the one beside that directory.
STUB_FILES = {"CLAUDE.md": "@AGENTS.md", "GEMINI.md": "@AGENTS.md"}
STUB_MAX_LINES = 3
# "any" accepts both forms; "symlink" or "import" pins the one the repository chose.
STUB_FORM = "any"
# Adapters every AGENTS.md needs beside it. Claude Code reads an AGENTS.md
# through the CLAUDE.md beside it; its built-in AGENTS.md reader stands down
# whenever a CLAUDE.md exists in any directory above the session.
REQUIRED_STUBS = ("CLAUDE.md",)

# The one real skills directory, and the vendor paths that must be relative
# symlinks to it. A Claude Code-only repository sets ".claude/skills" and ().
CANONICAL_SKILLS_ROOT = ".agents/skills"
SKILL_ROOT_LINKS = (".claude/skills",)

# Instruction copies that must not exist anywhere: file name -> why.
FORBIDDEN_FILES = {
    ".cursorrules": "Cursor's legacy rules file; Cursor reads AGENTS.md",
    ".windsurfrules": "Windsurf's legacy rules file; Windsurf reads AGENTS.md",
}
# Adapter directories the repository has decided against: path -> why.
FORBIDDEN_DIRS = {}

# Subagent definitions, each an envelope around the skill it preloads.
AGENT_DIRS = (".claude/agents",)
AGENT_BODY_MAX_LINES = 12
AGENT_REQUIRES_SKILL = True

# Codex stops reading instructions at project_doc_max_bytes (32 KiB by
# default) without a word, so the cap is checked here or nowhere.
INSTRUCTIONS_MAX_BYTES = 32768

# Directory names never scanned, at any depth: name -> why.
EXCLUDED_DIR_NAMES = {
    "node_modules": "vendored packages ship skills that are not this repository's",
}
# Paths never scanned: repo-relative path -> why. Git submodules and paths git
# ignores are excluded as well, and listed.
EXCLUDED_PATHS = {
    ".claude/worktrees": "linked checkouts of this repository, each checked on its own branch",
}
# Files whose skill paths name fixtures or examples, not this repository: path -> why.
CITATION_EXEMPT = {}
# SKILL.md files that are not skills (a template, a fixture): path -> why.
SKILL_FILE_EXEMPT = {}
# Home-directory names that are placeholders in prose, not someone's machine.
HOME_PLACEHOLDERS = ("you", "user", "username", "me", "name", "runner", "example")
# ---- end of configuration ----------------------------------------------------

CONFIG_NAMES = (
    "CANONICAL_INSTRUCTIONS",
    "STUB_FILES",
    "STUB_MAX_LINES",
    "STUB_FORM",
    "REQUIRED_STUBS",
    "CANONICAL_SKILLS_ROOT",
    "SKILL_ROOT_LINKS",
    "FORBIDDEN_FILES",
    "FORBIDDEN_DIRS",
    "AGENT_DIRS",
    "AGENT_BODY_MAX_LINES",
    "AGENT_REQUIRES_SKILL",
    "INSTRUCTIONS_MAX_BYTES",
    "EXCLUDED_DIR_NAMES",
    "EXCLUDED_PATHS",
    "CITATION_EXEMPT",
    "SKILL_FILE_EXEMPT",
    "HOME_PLACEHOLDERS",
)

# A hard rule fails in both modes; a soft rule warns under audit and fails
# under enforce; an advice rule warns in both, because its remedy is a decision.
HARD, SOFT, ADVICE = "hard", "soft", "advice"

# The Agent Skills grammar: lowercase words joined by single hyphens.
SKILL_NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SKILL_NAME_MAX = 64
DESCRIPTION_MAX = 1024
# Claude Code keeps claude.ai-synced skills in ~/.claude/skills/synced.
RESERVED_SKILL_NAMES = frozenset({"synced"})
# A relative path through a vendor skills directory; `$VAR/...` and `~/...`
# paths name another machine's directories, not this repository's.
SKILL_CITATION_RE = re.compile(
    r"(?<![\w./$-])((?:[\w.-]+/)*\.(?:agents|claude|codex|gemini|cursor|github|windsurf)"
    r"/skills/[\w.-]+(?:/[\w./-]*)?)"
)
# Directories whose contents are agent configuration, wherever they sit.
VENDOR_DIRS = frozenset(
    {".agents", ".claude", ".codex", ".gemini", ".cursor", ".windsurf"}
)
# `git show <sha>:<path>` names a path that is gone on purpose.
GIT_PINNED_RE = re.compile(r"[0-9a-f]{7,40}:$")
MD_LINK_RE = re.compile(
    r"!?\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+[\"'][^\"']*[\"'])?\s*\)"
)
HOME_PATH_RES = (
    re.compile(r"(?<![\w$~}])/(?:Users|home)/([\w.-]+)/"),
    re.compile(r"\b[A-Za-z]:\\Users\\([\w.-]+)\\"),
)
TEXT_SUFFIXES = frozenset(
    {".md", ".mdc", ".txt", ".py", ".sh", ".yml", ".yaml", ".toml", ".json"}
)
# Directories, besides the skills root and the agent directories, whose files
# an agent reads as instructions.
INSTRUCTION_DIRS = (".claude/rules", ".claude/commands")
BLOCK_SCALARS = frozenset({"|", ">", "|-", ">-", "|+", ">+"})
MAX_DETAILS = 40


class Report:
    """Collects every finding, so one run names every defect rather than the first."""

    def __init__(self, mode: str) -> None:
        self.mode = mode
        self.failures = 0
        self.warnings = 0

    @staticmethod
    def note(message: str) -> None:
        print(f"  --    {message}")

    def rule(
        self, rule_id: str, message: str, findings: list[str], severity: str = SOFT
    ) -> None:
        if not findings:
            print(f"  ok    {rule_id}: {message}")
            return
        failing = severity == HARD or (severity == SOFT and self.mode == "enforce")
        print(f"  {'FAIL' if failing else 'warn'}  {rule_id}: {message}")
        for finding in findings[:MAX_DETAILS]:
            print(f"          - {finding}")
        if len(findings) > MAX_DETAILS:
            print(f"          - ... and {len(findings) - MAX_DETAILS} more")
        if failing:
            self.failures += 1
        else:
            self.warnings += 1


def run_git(
    root: Path, *args: str, stdin: str | None = None, ok_codes: tuple[int, ...] = (0,)
) -> str | None:
    """Stdout of a git command, or None when git is missing or the command fails."""
    try:
        proc = subprocess.run(
            ["git", "-C", str(root), *args],
            input=stdin,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return None
    return proc.stdout if proc.returncode in ok_codes else None


def unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        return value[1:-1]
    return value


def split_frontmatter(text: str) -> tuple[dict[str, object] | None, str]:
    """The frontmatter's top-level keys and the body after it; None when there is none.

    A subset of YAML covering what skill and agent files use: plain, quoted and
    block (| or >) scalars, plain scalars continued on indented lines, and
    lists in flow ([a, b]) or block (- a) style. Not a YAML parser, so the
    guard stays standard-library only.
    """
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None, text
    fields: dict[str, object] = {}
    key = None
    block = False
    for index, line in enumerate(lines[1:], start=1):
        stripped = line.strip()
        if stripped == "---":
            return fields, "\n".join(lines[index + 1 :])
        if not stripped or (stripped.startswith("#") and not block):
            continue
        current = fields.get(key) if key is not None else None
        is_item = stripped == "-" or stripped.startswith("- ")
        if (
            key is not None
            and not block
            and is_item
            and (current == "" or isinstance(current, list))
        ):
            items = current if isinstance(current, list) else []
            items.append(unquote(stripped[1:].strip()))
            fields[key] = items
            continue
        if line[:1] in (" ", "\t"):
            if key is not None and isinstance(current, str):
                fields[key] = (current + " " + stripped).strip()
            continue
        if ":" in line:
            name, _, value = line.partition(":")
            key = name.strip()
            value = value.strip()
            block = value in BLOCK_SCALARS
            if block or not value:
                fields[key] = ""
            elif value.startswith("[") and value.endswith("]"):
                fields[key] = [
                    unquote(v.strip()) for v in value[1:-1].split(",") if v.strip()
                ]
            else:
                fields[key] = unquote(value)
            continue
        key = None
    return None, text


def as_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(v) for v in value if str(v)]
    if isinstance(value, str):
        return [v for v in re.split(r"[,\s]+", value) if v]
    return []


@dataclass(frozen=True)
class Skill:
    path: str
    root: str | None
    depth: int
    fields: dict | None
    symlink: bool

    @property
    def dirname(self) -> str:
        return PurePosixPath(self.path).parent.name


class Repo:
    """The files the guard judges: tracked plus untracked-but-not-ignored, exclusions applied."""

    def __init__(self, root: Path) -> None:
        self.root = root
        # A root anywhere inside a work tree is judged through git, so what git
        # ignores (a virtualenv, a build tree) is never taken for the repository's.
        self.git = (
            run_git(root, "rev-parse", "--is-inside-work-tree") or ""
        ).strip() == "true"
        self.submodules: list[str] = []
        self.tracked: set[str] = set()
        if self.git:
            staged = run_git(root, "ls-files", "-z", "-s") or ""
            for entry in staged.split("\0"):
                meta, _, path = entry.partition("\t")
                if meta.startswith("160000"):
                    self.submodules.append(path)
            self.tracked = {
                p for p in (run_git(root, "ls-files", "-z") or "").split("\0") if p
            }
            listed = (
                run_git(
                    root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"
                )
                or ""
            )
            candidates = sorted({p for p in listed.split("\0") if p})
            self.files = [
                p
                for p in candidates
                if os.path.lexists(root / p) and not self.excluded(p)
            ]
        else:
            self.files = self._walk()
        self.file_set = set(self.files)

    def excluded(self, rel: str) -> bool:
        parts = PurePosixPath(rel).parts
        if ".git" in parts or any(part in EXCLUDED_DIR_NAMES for part in parts):
            return True
        prefixes = list(EXCLUDED_PATHS) + self.submodules
        return any(rel == p or rel.startswith(p.rstrip("/") + "/") for p in prefixes)

    def _walk(self) -> list[str]:
        found = []
        for dirpath, dirnames, filenames in os.walk(self.root):
            rel_dir = Path(dirpath).relative_to(self.root).as_posix()
            rel_dir = "" if rel_dir == "." else rel_dir
            keep = []
            for name in dirnames:
                rel = f"{rel_dir}/{name}" if rel_dir else name
                if self.excluded(rel):
                    continue
                if os.path.islink(os.path.join(dirpath, name)):
                    found.append(rel)  # listed, never followed
                else:
                    keep.append(name)
            dirnames[:] = keep
            for name in filenames:
                rel = f"{rel_dir}/{name}" if rel_dir else name
                if not self.excluded(rel):
                    found.append(rel)
        return sorted(found)

    def read(self, rel: str) -> str:
        try:
            return (self.root / rel).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return ""

    def named(self, name: str) -> list[str]:
        return [p for p in self.files if PurePosixPath(p).name == name]

    def under(self, prefix: str) -> list[str]:
        prefix = prefix.rstrip("/") + "/"
        return [p for p in self.files if p.startswith(prefix)]


def collect_skills(repo: Repo) -> list[Skill]:
    skills = []
    for rel in repo.named("SKILL.md"):
        if rel in SKILL_FILE_EXEMPT:
            continue
        parts = PurePosixPath(rel).parts
        root_index = max(
            (i for i, part in enumerate(parts[:-1]) if part == "skills"), default=None
        )
        root = "/".join(parts[: root_index + 1]) if root_index is not None else None
        depth = len(parts) - root_index - 2 if root_index is not None else 0
        fields, _ = split_frontmatter(repo.read(rel))
        skills.append(Skill(rel, root, depth, fields, os.path.islink(repo.root / rel)))
    return skills


def check_skills(repo: Repo, rep: Report, skills: list[Skill]) -> None:
    """Names, grammar, required fields and uniqueness: what loaders route on."""
    missing, drift, grammar, too_long, shadowed, copies = [], [], [], [], [], []
    by_root_name: dict[tuple[str | None, str], str] = {}
    by_dirname: dict[str, list[str]] = {}
    for skill in skills:
        fields = skill.fields or {}
        name = str(fields.get("name", "")).strip()
        description = str(fields.get("description", "")).strip()
        if skill.fields is None:
            missing.append(f"{skill.path}: no frontmatter (--- name/description ---)")
        elif not name or not description:
            missing.append(
                f"{skill.path}: name={name!r} description={description[:40]!r}"
            )
        if name and name != skill.dirname:
            drift.append(f"{skill.path}: name {name!r} != directory {skill.dirname!r}")
        if (
            not SKILL_NAME_RE.match(skill.dirname)
            or len(skill.dirname) > SKILL_NAME_MAX
            or skill.dirname in RESERVED_SKILL_NAMES
        ):
            grammar.append(f"{skill.path}: {skill.dirname!r}")
        if len(description) > DESCRIPTION_MAX:
            too_long.append(f"{skill.path}: {len(description)} characters")
        if name:
            other = by_root_name.get((skill.root, name))
            if other:
                shadowed.append(f"{skill.path} and {other} both answer to {name!r}")
            by_root_name[(skill.root, name)] = skill.path
        by_dirname.setdefault(skill.dirname, []).append(skill.path)
    for dirname, paths in sorted(by_dirname.items()):
        if len({PurePosixPath(p).parent.parent.as_posix() for p in paths}) > 1:
            copies.append(f"{dirname!r} in " + ", ".join(paths))

    rep.note(f"scanned {len(skills)} SKILL.md file(s)")
    rep.rule(
        "skill-fields",
        "every SKILL.md has frontmatter with a name and a description",
        missing,
        HARD,
    )
    rep.rule(
        "skill-unique",
        "no two skills in one root answer to the same name",
        shadowed,
        HARD,
    )
    rep.rule(
        "skill-name",
        "every frontmatter name equals its directory name, as the Agent Skills "
        "spec requires; otherwise one skill answers to two names",
        drift,
    )
    rep.rule(
        "skill-grammar",
        f"every skill directory is lowercase-hyphenated, at most "
        f"{SKILL_NAME_MAX} characters, not reserved",
        grammar,
    )
    rep.rule(
        "skill-description",
        f"every description fits in {DESCRIPTION_MAX} characters",
        too_long,
    )
    rep.rule(
        "skill-copies", "no skill name exists in two places (copies drift)", copies
    )


def check_placement(repo: Repo, rep: Report, skills: list[Skill]) -> None:
    """Where skills sit: one level under the one canonical root, as regular files."""
    misplaced = []
    for skill in skills:
        if skill.root is None:
            misplaced.append(
                f"{skill.path}: under no skills/ directory, so no loader finds it"
            )
        elif skill.depth != 1:
            misplaced.append(
                f"{skill.path}: {skill.depth} levels under {skill.root}/; "
                f"Claude Code loads <root>/<name>/SKILL.md only"
            )
        if skill.symlink:
            misplaced.append(
                f"{skill.path}: a symlink; link the skills directory, not single files"
            )
    rep.rule(
        "skill-placement",
        "every SKILL.md sits at <root>/<name>/SKILL.md as a regular file",
        misplaced,
    )

    roots = sorted({s.root for s in skills if s.root is not None})
    for root in roots:
        rep.note(f"skills root: {root}")
    others = [
        f"{root}: a second root; a nested one exists only for sessions started inside it"
        for root in roots
        if root != CANONICAL_SKILLS_ROOT
    ]
    rep.rule("one-root", f"{CANONICAL_SKILLS_ROOT} is the only skills root", others)


def check_root_links(repo: Repo, rep: Report, skills: list[Skill]) -> None:
    """The canonical root is a real directory and each vendor root is a relative link to it."""
    canonical = repo.root / CANONICAL_SKILLS_ROOT
    if not skills and not os.path.lexists(canonical):
        rep.note("no skills in this repository: the skills-root links are not checked")
        return
    findings = []
    if canonical.is_symlink() or not canonical.is_dir():
        findings.append(f"{CANONICAL_SKILLS_ROOT} is not a real directory")
    for link in SKILL_ROOT_LINKS:
        path = repo.root / link
        if not path.is_symlink():
            state = "a real directory" if path.is_dir() else "missing"
            findings.append(
                f"{link} is {state}, not a symlink to {CANONICAL_SKILLS_ROOT}"
            )
            continue
        target = os.readlink(path)
        if os.path.isabs(target):
            findings.append(
                f"{link} -> {target}: absolute, so it resolves in one checkout only"
            )
        elif (path.parent / target).resolve() != canonical.resolve():
            findings.append(
                f"{link} -> {target}: resolves to {(path.parent / target).resolve()}"
            )
        if repo.git and link in repo.tracked:
            mode = (run_git(repo.root, "ls-files", "-s", "--", link) or "").split(
                " ", 1
            )[0]
            if mode != "120000":
                findings.append(
                    f"{link}: git records mode {mode}, not 120000 (a symlink)"
                )
    rep.rule(
        "root-links",
        f"{CANONICAL_SKILLS_ROOT} is real and "
        f"{', '.join(SKILL_ROOT_LINKS) or 'no vendor path'} links to it relatively",
        findings,
    )


def is_agent_path(rel: str) -> bool:
    """Whether a path is agent configuration: an instruction file, or inside a vendor or skills directory."""
    parts = PurePosixPath(rel).parts
    names = {
        CANONICAL_INSTRUCTIONS,
        "SKILL.md",
        "CLAUDE.local.md",
        *STUB_FILES,
        *FORBIDDEN_FILES,
    }
    if parts[-1] in names or any(
        part in VENDOR_DIRS or part == "skills" for part in parts
    ):
        return True
    return any(
        rel == d or rel.startswith(d.rstrip("/") + "/")
        for d in (*AGENT_DIRS, *INSTRUCTION_DIRS)
    )


def check_symlinks(repo: Repo, rep: Report) -> None:
    """Links in the agent configuration resolve, inside the repository; other links are not this guard's."""
    dangling, escaping = [], []
    top = repo.root.resolve()
    for rel in repo.files:
        path = repo.root / rel
        if not path.is_symlink() or not is_agent_path(rel):
            continue
        if not path.exists():
            dangling.append(f"{rel} -> {os.readlink(path)}")
            continue
        try:
            path.resolve().relative_to(top)
        except ValueError:
            escaping.append(f"{rel} -> {path.resolve()}")
    rep.rule(
        "symlinks", "no dangling symlink in the agent configuration", dangling, HARD
    )
    rep.rule(
        "symlinks",
        "no symlink in the agent configuration leaves the repository",
        escaping,
        HARD,
    )


def canonical_for(rel: str) -> str:
    """The canonical file a stub stands for: beside it, or beside its dot-directory."""
    parts = PurePosixPath(rel).parent.parts
    for index, part in enumerate(parts):
        if part.startswith("."):
            parts = parts[:index]
            break
    return "/".join((*parts, CANONICAL_INSTRUCTIONS))


def check_ignored(repo: Repo, rep: Report) -> None:
    """Nothing git ignores is meant to be read: an ignored AGENTS.md is written and never shared."""
    names = (CANONICAL_INSTRUCTIONS, *STUB_FILES)
    written, hazards = [], []
    if repo.git:
        dirs = {""} | {PurePosixPath(p).parent.as_posix() for p in repo.files}
        dirs.discard(".")
        for directory in sorted(dirs):
            for name in names:
                rel = f"{directory}/{name}" if directory else name
                if (
                    rel not in repo.file_set
                    and (repo.root / rel).is_file()
                    and not repo.excluded(rel)
                ):
                    written.append(
                        f"{rel}: on disk, ignored by git, so no one else ever gets it"
                    )
        candidates = {p for p in repo.files if PurePosixPath(p).name in names}
        candidates |= {
            canonical_for(p) for p in repo.files if PurePosixPath(p).name in STUB_FILES
        }
        candidates.add(f"{CANONICAL_SKILLS_ROOT}/probe/SKILL.md")
        out = (
            run_git(
                repo.root,
                "check-ignore",
                "--no-index",
                "-v",
                "-z",
                "--stdin",
                stdin="\0".join(sorted(candidates)) + "\0",
                ok_codes=(0, 1),
            )
            or ""
        )
        fields = out.split("\0")
        for i in range(0, len(fields) - 3, 4):
            source, line, pattern, path = fields[i : i + 4]
            if pattern.startswith("!"):
                continue
            where = CANONICAL_SKILLS_ROOT if path.endswith("/probe/SKILL.md") else path
            hazards.append(f"{where}: matched by {source}:{line}: {pattern}")
    else:
        for rel in repo.named(".gitignore"):
            for number, raw in enumerate(repo.read(rel).splitlines(), start=1):
                pattern = raw.strip()
                if not pattern or pattern.startswith(("#", "!")):
                    continue
                bare = pattern.strip("/")
                if any(fnmatch.fnmatch(name, bare) for name in names) or bare in (
                    CANONICAL_SKILLS_ROOT,
                    CANONICAL_SKILLS_ROOT.split("/", 1)[0],
                ):
                    hazards.append(f"{rel}:{number}: {pattern}")
    rep.rule("ignored", "no instruction file git ignores exists on disk", written, HARD)
    rep.rule(
        "ignored",
        "no .gitignore pattern matches an instruction file or the skills root",
        hazards,
    )


def check_stubs(repo: Repo, rep: Report) -> None:
    """Adapters point at the AGENTS.md beside them, which is a real file holding the instructions."""
    findings, erased = [], []
    for name, token in STUB_FILES.items():
        for rel in repo.named(name):
            path = repo.root / rel
            canonical = canonical_for(rel)
            if path.is_symlink():
                target = os.readlink(path)
                if STUB_FORM == "import":
                    findings.append(
                        f"{rel}: a symlink; adapters here are stubs importing {canonical}"
                    )
                elif os.path.isabs(target):
                    findings.append(
                        f"{rel} -> {target}: absolute, so it resolves in one checkout only"
                    )
                elif (
                    not path.exists()
                    or path.resolve() != (repo.root / canonical).resolve()
                ):
                    findings.append(
                        f"{rel} -> {target}: does not resolve to {canonical}"
                    )
                continue
            if STUB_FORM == "symlink":
                findings.append(
                    f"{rel}: a file; adapters here are relative symlinks to {canonical}"
                )
            lines = [
                line.strip() for line in repo.read(rel).splitlines() if line.strip()
            ]
            if len(lines) > STUB_MAX_LINES:
                findings.append(
                    f"{rel}: {len(lines)} non-blank lines; a stub holds {STUB_MAX_LINES} at most"
                )
            if token not in lines:
                findings.append(f"{rel}: no {token!r} line")
            if canonical not in repo.file_set:
                findings.append(f"{rel}: no {canonical} for it to import")
    own_imports = {f"@{CANONICAL_INSTRUCTIONS}", f"@./{CANONICAL_INSTRUCTIONS}"}
    for rel in repo.named(CANONICAL_INSTRUCTIONS):
        if (repo.root / rel).is_symlink():
            findings.append(
                f"{rel} -> {os.readlink(repo.root / rel)}: a link, so the instructions live "
                f"elsewhere; make {rel} the real file"
            )
        if own_imports & {line.strip() for line in repo.read(rel).splitlines()}:
            erased.append(
                f"{rel}: imports itself, so its instructions are gone "
                f"(a stub written through a symlink overwrites the file it points at)"
            )
        for stub in REQUIRED_STUBS:
            sibling = str(PurePosixPath(rel).with_name(stub))
            if sibling not in repo.file_set:
                findings.append(f"{rel}: no {stub} beside it")
    rep.rule(
        "stubs",
        f"every {CANONICAL_INSTRUCTIONS} is a real file with "
        f"{'/'.join(REQUIRED_STUBS) or 'whatever adapters it needs'} beside it, and every "
        f"{'/'.join(STUB_FILES) or 'adapter'} is a relative symlink to it or a stub importing it",
        findings,
    )
    rep.rule("stubs", f"no {CANONICAL_INSTRUCTIONS} imports itself", erased, HARD)


def check_forbidden(repo: Repo, rep: Report) -> None:
    findings = [
        f"{rel}: {why}"
        for name, why in FORBIDDEN_FILES.items()
        for rel in repo.named(name)
    ]
    findings += [
        f"{path}/: {why}"
        for path, why in FORBIDDEN_DIRS.items()
        if os.path.lexists(repo.root / path)
    ]
    rep.rule(
        "forbidden",
        "no instruction copy or adapter the repository has decided against",
        findings,
    )


def agent_files(repo: Repo) -> list[str]:
    return [p for d in AGENT_DIRS for p in repo.under(d) if p.endswith(".md")]


def check_agents(repo: Repo, rep: Report, skills: list[Skill]) -> None:
    """Subagents preload skills that exist, and stay envelopes around them."""
    known = {s.dirname for s in skills} | {
        str((s.fields or {}).get("name", "")) for s in skills
    }
    unresolved, plugin_refs, fat = [], [], []
    files = agent_files(repo)
    for rel in files:
        fields, body = split_frontmatter(repo.read(rel))
        if fields is None:
            fat.append(f"{rel}: no frontmatter")
            continue
        preload = as_list(fields.get("skills"))
        for name in preload:
            if ":" in name:
                plugin_refs.append(f"{rel}: {name}")
            elif name not in known:
                unresolved.append(f"{rel}: skills: {name}")
        if AGENT_REQUIRES_SKILL and not preload:
            fat.append(
                f"{rel}: no `skills:` preload, so its procedure lives where only one agent reads it"
            )
        body_lines = [line for line in body.splitlines() if line.strip()]
        if len(body_lines) > AGENT_BODY_MAX_LINES:
            fat.append(
                f"{rel}: {len(body_lines)} body lines, more than {AGENT_BODY_MAX_LINES}"
            )
    for ref in plugin_refs:
        rep.note(f"plugin skill, not checked here: {ref}")
    rep.rule(
        "agent-skills",
        f"every `skills:` entry in {len(files)} subagent file(s) resolves",
        unresolved,
        HARD,
    )
    rep.rule(
        "agent-envelope",
        f"every subagent preloads a skill and keeps its body to "
        f"{AGENT_BODY_MAX_LINES} lines",
        fat,
    )


def check_citations(repo: Repo, rep: Report) -> None:
    """A skill path written into a file still points at something."""
    broken = set()
    for rel in repo.files:
        if rel in CITATION_EXEMPT or PurePosixPath(rel).suffix not in TEXT_SUFFIXES:
            continue
        text = repo.read(rel)
        for match in SKILL_CITATION_RE.finditer(text):
            cited = match.group(1).rstrip("/.,);:")
            if GIT_PINNED_RE.search(text[max(0, match.start() - 41) : match.start()]):
                continue
            base = PurePosixPath(rel).parent
            bases = [PurePosixPath(""), base, *base.parents]
            if not any(os.path.lexists(repo.root / b / cited) for b in bases):
                broken.add(f"{rel}: {cited}")
    rep.rule("citations", "every skill path cited in the tree resolves", sorted(broken))


def instruction_files(repo: Repo, skills: list[Skill]) -> list[str]:
    """Every file an agent reads as instructions, wherever its skill sits today."""
    names = {CANONICAL_INSTRUCTIONS, *STUB_FILES, *FORBIDDEN_FILES}
    found = {p for p in repo.files if PurePosixPath(p).name in names}
    prefixes = {CANONICAL_SKILLS_ROOT, *AGENT_DIRS, *INSTRUCTION_DIRS}
    prefixes |= {PurePosixPath(s.path).parent.as_posix() for s in skills}
    for prefix in prefixes:
        found |= {
            p for p in repo.under(prefix) if PurePosixPath(p).suffix in TEXT_SUFFIXES
        }
    # A link's content is judged at its target, once.
    return sorted(p for p in found if not (repo.root / p).is_symlink())


def markdown_links(text: str):
    """(line number, target) of each Markdown link outside code, which is where templates live."""
    fence = None
    for number, line in enumerate(text.splitlines(), start=1):
        stripped = line.lstrip()
        if stripped.startswith(("```", "~~~")):
            marker = stripped[:3]
            fence = None if fence == marker else (fence or marker)
            continue
        if fence is None:
            for match in MD_LINK_RE.finditer(re.sub(r"`[^`]*`", "", line)):
                yield number, match.group(1)


def check_links(repo: Repo, rep: Report, skills: list[Skill]) -> None:
    """A relative link in an instruction file still points at something: moves break them."""
    broken = []
    for rel in instruction_files(repo, skills):
        if PurePosixPath(rel).suffix not in (".md", ".mdc"):
            continue
        for number, target in markdown_links(repo.read(rel)):
            if (
                re.match(r"^[A-Za-z][\w+.-]*:", target)
                or target.startswith("#")
                or "{" in target
            ):
                continue
            path = urllib.parse.unquote(target.split("#", 1)[0].split("?", 1)[0])
            if not path:
                continue
            base = repo.root if path.startswith("/") else (repo.root / rel).parent
            if not os.path.lexists(base / path.lstrip("/")):
                broken.append(f"{rel}:{number}: {target}")
    rep.rule(
        "links",
        "every relative Markdown link in an instruction or skill file resolves",
        broken,
    )


def check_home_paths(repo: Repo, rep: Report, skills: list[Skill]) -> None:
    placeholders = {h.lower() for h in HOME_PLACEHOLDERS}
    findings = []
    for rel in instruction_files(repo, skills):
        for number, line in enumerate(repo.read(rel).splitlines(), start=1):
            for pattern in HOME_PATH_RES:
                for match in pattern.finditer(line):
                    if match.group(1).lower() not in placeholders:
                        findings.append(f"{rel}:{number}: {match.group(0)}")
    # Advice, not a failure: prose quoting a wrong path to warn about it is legitimate.
    rep.rule(
        "home-paths",
        "no instruction points into one person's home directory",
        findings,
        ADVICE,
    )


def check_personal(repo: Repo, rep: Report) -> None:
    if not repo.git:
        rep.note("not a git checkout: personal files are not checked")
        return
    findings = [
        rel
        for rel in sorted(repo.tracked)
        if PurePosixPath(rel).name == "CLAUDE.local.md"
        or (
            PurePosixPath(rel).name == "settings.local.json"
            and PurePosixPath(rel).parent.name == ".claude"
        )
    ]
    rep.rule("personal-files", "no personal agent file is committed", findings)


def canonical_text(repo: Repo, rep: Report) -> tuple[str, str]:
    if CANONICAL_INSTRUCTIONS in repo.file_set:
        return CANONICAL_INSTRUCTIONS, repo.read(CANONICAL_INSTRUCTIONS)
    for name in STUB_FILES:
        if name in repo.file_set and rep.mode == "audit":
            rep.note(
                f"no {CANONICAL_INSTRUCTIONS} yet: settings are compared with {name}"
            )
            return name, repo.read(name)
    return CANONICAL_INSTRUCTIONS, ""


def deny_prefixes(settings: dict) -> tuple[list[str], list[str]]:
    """The command prefixes `Bash(...)` deny rules name, and every other deny rule."""
    prefixes, others = [], []
    permissions = settings.get("permissions")
    deny = permissions.get("deny") if isinstance(permissions, dict) else None
    for entry in deny if isinstance(deny, list) else []:
        match = re.fullmatch(r"Bash\((.+?)(?::\*|\s*\*)?\)", str(entry).strip())
        if match:
            prefixes.append(match.group(1).strip())
        else:
            others.append(str(entry))
    return prefixes, others


def check_settings(repo: Repo, rep: Report) -> None:
    """A rule one agent enforces mechanically is stated in prose for every other agent."""
    path = repo.root / ".claude" / "settings.json"
    if not path.is_file():
        rep.note(
            "no .claude/settings.json: env and permission statements are not checked"
        )
        return
    try:
        settings = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        rep.rule("settings", ".claude/settings.json parses", [str(exc)], HARD)
        return
    if not isinstance(settings, dict):
        rep.rule(
            "settings",
            ".claude/settings.json holds a JSON object",
            [f"it holds a JSON {type(settings).__name__}"],
            HARD,
        )
        return
    name, text = canonical_text(repo, rep)

    drift, unstated = [], []
    env = settings.get("env")
    for key, value in sorted((env if isinstance(env, dict) else {}).items()):
        stated = set(
            re.findall(rf"(?<![\w]){re.escape(key)}\s*=\s*`?([^\s`'\",;)]+)", text)
        )
        if not stated:
            unstated.append(key)
        elif stated != {str(value)}:
            drift.append(
                f"{key}: settings.json sets {value!r}, {name} says {', '.join(sorted(stated))}"
            )
    if unstated:
        rep.note(
            f"env not stated in {name} (fine unless an agent needs it): {', '.join(unstated)}"
        )
    rep.rule(
        "settings-env",
        f"every env value {name} states matches .claude/settings.json",
        drift,
    )

    prefixes, others = deny_prefixes(settings)
    if others:
        rep.note(f"non-Bash deny rules, not compared with {name}: {', '.join(others)}")
    missing = [f"not stated: `{p}`" for p in prefixes if f"`{p}`" not in text]
    rep.rule(
        "settings-deny",
        f"{name} names every one of the {len(prefixes)} denied command prefixes, "
        f"so agents without the deny list follow it too",
        missing,
    )


def check_size(repo: Repo, rep: Report) -> None:
    """The canonical file fits the cap Codex truncates at, and so does each chain."""
    if not (repo.root / CANONICAL_INSTRUCTIONS).is_file():
        rep.rule(
            "size",
            f"{CANONICAL_INSTRUCTIONS} exists at the root",
            [f"no readable {CANONICAL_INSTRUCTIONS}"],
        )
        return
    size = (repo.root / CANONICAL_INSTRUCTIONS).stat().st_size
    lines = repo.read(CANONICAL_INSTRUCTIONS).count("\n") + 1
    rep.note(
        f"{CANONICAL_INSTRUCTIONS} is {size} bytes, {lines} lines (cap {INSTRUCTIONS_MAX_BYTES})"
    )
    over = [f"{size} bytes"] if size >= INSTRUCTIONS_MAX_BYTES else []
    rep.rule(
        "size",
        f"{CANONICAL_INSTRUCTIONS} is under {INSTRUCTIONS_MAX_BYTES} bytes",
        over,
    )

    # Codex concatenates the root file and every one down to the session's
    # directory, and the cap cuts the end: the most specific file goes first.
    nested = [
        p
        for p in repo.named(CANONICAL_INSTRUCTIONS)
        if p != CANONICAL_INSTRUCTIONS and (repo.root / p).is_file()
    ]
    chains = []
    for rel in nested:
        directory = PurePosixPath(rel).parent
        chain = [
            p
            for p in nested
            if PurePosixPath(p).parent in (directory, *directory.parents)
        ]
        total = size + sum((repo.root / p).stat().st_size for p in chain)
        if total >= INSTRUCTIONS_MAX_BYTES:
            chains.append(
                f"{directory}/: chain of {total} bytes, {total - INSTRUCTIONS_MAX_BYTES} over; "
                f"a Codex session started there loses the end of {rel}"
            )
    if nested:
        rep.rule(
            "chain",
            f"every root-to-component {CANONICAL_INSTRUCTIONS} chain fits the cap",
            chains,
            ADVICE,
        )


def apply_config(path: Path) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("the config file holds a JSON object")
    unknown = sorted(set(data) - set(CONFIG_NAMES))
    if unknown:
        raise ValueError(f"unknown configuration name(s): {', '.join(unknown)}")
    for name, value in data.items():
        default = globals()[name]
        if isinstance(default, tuple):
            if not isinstance(value, list) or not all(
                isinstance(v, str) for v in value
            ):
                raise ValueError(f"{name} takes a list of strings")
            globals()[name] = tuple(value)
            continue
        if isinstance(default, dict):
            if not isinstance(value, dict) or not all(
                isinstance(v, str) for v in value.values()
            ):
                raise ValueError(f"{name} takes an object whose values are strings")
        elif type(value) is not type(default):
            raise ValueError(f"{name} takes a {type(default).__name__}")
        globals()[name] = value
    if STUB_FORM not in ("any", "symlink", "import"):
        raise ValueError("STUB_FORM is one of any, symlink, import")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--mode",
        choices=("audit", "enforce"),
        default="enforce",
        help="audit warns where enforce fails (default: enforce)",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="repository root (default: the git top level of the current directory)",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=None,
        help="JSON object overriding CONFIGURATION names",
    )
    args = parser.parse_args()

    if args.config is not None:
        try:
            apply_config(args.config)
        except (OSError, ValueError) as exc:
            print(
                f"agent-config guard: cannot read {args.config}: {exc}", file=sys.stderr
            )
            return 2
    root = args.root
    if root is None:
        toplevel = run_git(Path.cwd(), "rev-parse", "--show-toplevel")
        root = Path(toplevel.strip()) if toplevel else Path.cwd()
    root = root.resolve()
    if not root.is_dir():
        print(f"agent-config guard: {root} is not a directory", file=sys.stderr)
        return 2

    repo = Repo(root)
    rep = Report(args.mode)
    print(f"agent-config guard: mode={args.mode} root={root}")
    print(
        f"  --    canonical: {CANONICAL_INSTRUCTIONS}, skills in {CANONICAL_SKILLS_ROOT}; "
        f"adapters: {', '.join(STUB_FILES) or 'none'} ({STUB_FORM}); "
        f"skills links: {', '.join(SKILL_ROOT_LINKS) or 'none'}"
    )
    for name, why in sorted(EXCLUDED_DIR_NAMES.items()):
        rep.note(f"excluded: {name}/ anywhere ({why})")
    for path, why in sorted(EXCLUDED_PATHS.items()):
        rep.note(f"excluded: {path} ({why})")
    for path in repo.submodules:
        rep.note(
            f"excluded: {path} (git submodule; its agent config belongs to its own repository)"
        )
    rep.note(
        "excluded: paths git ignores"
        if repo.git
        else "not a git checkout: every file on disk is judged"
    )
    for path, why in sorted(CITATION_EXEMPT.items()):
        rep.note(f"citation-exempt: {path} ({why})")
    for path, why in sorted(SKILL_FILE_EXEMPT.items()):
        rep.note(f"not a skill: {path} ({why})")

    skills = collect_skills(repo)
    check_skills(repo, rep, skills)
    check_placement(repo, rep, skills)
    check_root_links(repo, rep, skills)
    check_symlinks(repo, rep)
    check_ignored(repo, rep)
    check_stubs(repo, rep)
    check_forbidden(repo, rep)
    check_agents(repo, rep, skills)
    check_citations(repo, rep)
    check_links(repo, rep, skills)
    check_home_paths(repo, rep, skills)
    check_personal(repo, rep)
    check_settings(repo, rep)
    check_size(repo, rep)

    print()
    if rep.warnings:
        print(
            f"{rep.warnings} warning(s)"
            + (
                "; --mode enforce fails on each soft one."
                if args.mode == "audit"
                else "."
            )
        )
    elif args.mode == "audit":
        print("The tree meets every rule: run with --mode enforce.")
    if rep.failures:
        print(f"{rep.failures} failure(s).")
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
