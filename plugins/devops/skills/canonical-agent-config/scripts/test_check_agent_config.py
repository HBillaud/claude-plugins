#!/usr/bin/env python3
"""Tests for check_agent_config.py: run python3 test_check_agent_config.py

Every case builds its own temporary tree and runs the guard with the
configuration it ships with, passed explicitly, so the suite pins what the
guard detects, not the state of any repository nor the decisions a repository
writes into its CONFIGURATION block. The failure cases are the ones the layout
invites: a symlink a merge turned back into a directory, an absolute link that
resolves in one checkout only, a skill renamed in its frontmatter but not on
disk, an AGENTS.md a .gitignore swallows, a stub written through a link.

Skill paths are assembled from parts so that this file, copied into a
repository, never reads to the guard as a citation of that repository.

Hermetic: no network, and git runs with no global or system configuration (no
signing, no hooks, no global excludes). Python 3.9+.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

GUARD = Path(__file__).resolve().parent / "check_agent_config.py"
SKILLS = Path(".agents") / "skills"
CLAUDE_SKILLS = Path(".claude") / "skills"
STUB = "# CLAUDE.md\n\n@AGENTS.md\n"
AGENTS = (
    "# Repository Instructions\n\nBuild with `make`. Tests run with `RUN_JOBS=8`.\n"
)
# The configuration the guard ships with, so a repository's own decisions never change what this suite checks.
DEFAULTS = {
    "CANONICAL_INSTRUCTIONS": "AGENTS.md",
    "STUB_FILES": {"CLAUDE.md": "@AGENTS.md", "GEMINI.md": "@AGENTS.md"},
    "STUB_MAX_LINES": 3,
    "STUB_FORM": "any",
    "REQUIRED_STUBS": ["CLAUDE.md"],
    "CANONICAL_SKILLS_ROOT": SKILLS.as_posix(),
    "SKILL_ROOT_LINKS": [CLAUDE_SKILLS.as_posix()],
    "FORBIDDEN_FILES": {".cursorrules": "a copy", ".windsurfrules": "a copy"},
    "FORBIDDEN_DIRS": {},
    "AGENT_DIRS": [".claude/agents"],
    "AGENT_BODY_MAX_LINES": 12,
    "AGENT_REQUIRES_SKILL": True,
    "INSTRUCTIONS_MAX_BYTES": 32768,
    "EXCLUDED_DIR_NAMES": {"node_modules": "vendored"},
    "EXCLUDED_PATHS": {".claude/worktrees": "linked checkouts"},
    "CITATION_EXEMPT": {},
    "SKILL_FILE_EXEMPT": {},
    "HOME_PLACEHOLDERS": ["you", "user", "username", "me", "name", "runner", "example"],
}

_failures = 0
_env: dict[str, str] = {}


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def skill(
    root: Path,
    name: str,
    parent: Path = SKILLS,
    *,
    frontmatter_name: str | None = None,
    description: str = "A probe skill for the guard's own tests.",
    extra: str = "",
) -> Path:
    fm_name = name if frontmatter_name is None else frontmatter_name
    return write(
        root / parent / name / "SKILL.md",
        f"---\nname: {fm_name}\ndescription: {description}\n{extra}---\n\n# {name}\n",
    )


def link(target: str, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink() or path.exists():
        path.unlink()
    os.symlink(target, str(path))


def valid_tree(base: Path, label: str) -> Path:
    """A tree that meets every rule under the shipped configuration."""
    root = base / label
    skill(root, "alpha")
    skill(root, "beta", extra='paths:\n  - "src/**"\n')
    link(os.path.join("..", ".agents", "skills"), root / CLAUDE_SKILLS)
    write(
        root / ".claude" / "settings.json",
        json.dumps(
            {"env": {"RUN_JOBS": "8"}, "permissions": {"deny": ["Bash(sudo *)"]}}
        ),
    )
    write(root / "AGENTS.md", AGENTS + "Never run `sudo`.\n")
    write(root / "CLAUDE.md", STUB)
    write(root / "component" / "AGENTS.md", "# Component\n\nComponent rules.\n")
    write(root / "component" / "CLAUDE.md", STUB)
    write(
        root / ".claude" / "agents" / "reviewer.md",
        "---\nname: reviewer\ndescription: Reviews a diff.\ntools: Read, Grep\n"
        "skills:\n  - alpha\n---\n\nReview the diff with the alpha skill.\n",
    )
    write(root / ".gitignore", "build/\n")
    return root


def unmigrated_tree(base: Path, label: str) -> Path:
    """A typical tree before the migration: real .claude/skills, a long CLAUDE.md."""
    root = base / label
    skill(root, "alpha", CLAUDE_SKILLS)
    skill(root, "nested", CLAUDE_SKILLS / "group")
    write(root / "CLAUDE.md", "# CLAUDE.md\n\n" + "A real line of guidance.\n" * 40)
    write(root / ".cursorrules", "A real line of guidance.\n" * 40)
    write(
        root / ".claude" / "agents" / "fat.md",
        "---\nname: fat\ndescription: Does everything.\n---\n\n"
        + "A step of procedure.\n" * 30,
    )
    return root


def git(root: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-C", str(root), *args], check=True, capture_output=True, env=_env
    )


def git_init(root: Path) -> None:
    git(root, "init", "-q")
    git(root, "add", "-A")
    git(
        root,
        "-c",
        "user.email=guard@example.com",
        "-c",
        "user.name=guard",
        "commit",
        "-q",
        "-m",
        "fixture",
    )


def run(
    root: Path, mode: str = "enforce", config: dict | None = None
) -> tuple[int, str]:
    settings = dict(DEFAULTS, **(config or {}))
    config_file = write(root.parent / f"{root.name}.config.json", json.dumps(settings))
    command = [
        sys.executable,
        str(GUARD),
        "--mode",
        mode,
        "--root",
        str(root),
        "--config",
        str(config_file),
    ]
    proc = subprocess.run(
        command, capture_output=True, text=True, check=False, env=_env
    )
    return proc.returncode, proc.stdout + proc.stderr


def report(condition: bool, label: str, output: str) -> None:
    global _failures
    print(f"{'PASS' if condition else 'FAIL'}  {label}")
    if not condition:
        _failures += 1
        print("\n".join("        " + line for line in output.strip().splitlines()))


def expect_pass(
    root: Path, label: str, mode: str = "enforce", config: dict | None = None
) -> str:
    code, out = run(root, mode, config)
    report(code == 0 and "Traceback" not in out, label, out)
    return out


def expect_fail(
    root: Path,
    label: str,
    marker: str,
    mode: str = "enforce",
    config: dict | None = None,
) -> None:
    code, out = run(root, mode, config)
    failed = [
        line
        for line in out.splitlines()
        if line.startswith("  FAIL") and marker in line
    ]
    report(
        code == 1 and bool(failed) and "Traceback" not in out,
        f"{label} [{marker}]",
        out,
    )


def expect_warn(root: Path, label: str, marker: str, mode: str = "audit") -> None:
    code, out = run(root, mode)
    warned = [
        line
        for line in out.splitlines()
        if line.startswith("  warn") and marker in line
    ]
    report(code == 0 and bool(warned), f"{label} [{marker}]", out)


def main() -> int:
    global _env
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        for directory in ("home", "xdg"):
            (base / directory).mkdir()
        _env = dict(
            os.environ,
            GIT_CONFIG_GLOBAL=os.devnull,
            GIT_CONFIG_NOSYSTEM="1",
            HOME=str(base / "home"),
            XDG_CONFIG_HOME=str(base / "xdg"),
        )

        out = expect_pass(
            valid_tree(base, "valid"), "a tree that meets every rule passes"
        )
        report("warn" not in out, "  ... and raises no warning", out)
        out = expect_pass(
            valid_tree(base, "valid-audit"),
            "audit mode passes the same tree",
            mode="audit",
        )
        report("--mode enforce" in out, "  ... and says to switch to enforce", out)

        # The guard lands before the migration: audit passes the old tree and lists the work.
        root = unmigrated_tree(base, "unmigrated")
        out = expect_pass(root, "audit passes an unmigrated tree", mode="audit")
        for marker in (
            "one-root",
            "skill-placement",
            "root-links",
            "stubs",
            "forbidden",
            "agent-envelope",
            "size",
        ):
            report(
                f"warn  {marker}" in out, f"  ... and lists {marker} as a warning", out
            )
        expect_fail(root, "enforce fails the same tree", "root-links")

        # What loaders route on.
        root = valid_tree(base, "drift")
        skill(root, "alpha", frontmatter_name="alpha-renamed")
        expect_fail(
            root,
            "a frontmatter name that drifts from its directory fails",
            "skill-name",
        )
        for label, name in (
            ("upper", "Alpha_Upper"),
            ("trailing", "alpha-"),
            ("double", "al--pha"),
            ("reserved", "synced"),
            ("long", "a" * 65),
        ):
            root = valid_tree(base, f"grammar-{label}")
            skill(root, name)
            expect_fail(root, f"a skill named {name[:12]!r} fails", "skill-grammar")
        root = valid_tree(base, "no-description")
        write(
            root / SKILLS / "alpha" / "SKILL.md",
            "---\nname: alpha\ndescription:\n---\n",
        )
        expect_fail(
            root,
            "an empty description fails even in audit mode",
            "skill-fields",
            mode="audit",
        )
        root = valid_tree(base, "no-frontmatter")
        write(
            root / SKILLS / "alpha" / "SKILL.md", "# alpha\n\nNo frontmatter at all.\n"
        )
        expect_fail(root, "a SKILL.md with no frontmatter fails", "skill-fields")
        root = valid_tree(base, "long-description")
        skill(root, "alpha", description="word " * 230)
        expect_fail(
            root, "a description over 1024 characters fails", "skill-description"
        )
        root = valid_tree(base, "block-description")
        write(
            root / SKILLS / "alpha" / "SKILL.md",
            "---\nname: alpha\ndescription: >\n  Folded over\n  two lines.\n---\n",
        )
        expect_pass(root, "a folded block-scalar description is read")
        root = valid_tree(base, "shadowed")
        skill(root, "gamma", frontmatter_name="alpha")
        expect_fail(
            root,
            "two skills answering to one name fail even in audit mode",
            "skill-unique",
            mode="audit",
        )

        # Where skills sit.
        root = valid_tree(base, "copies")
        skill(root, "alpha", Path(".codex") / "skills")
        expect_fail(root, "one skill in two roots fails", "skill-copies")
        root = valid_tree(base, "too-deep")
        skill(root, "nested", SKILLS / "group")
        expect_fail(root, "a skill two levels down fails", "skill-placement")
        root = valid_tree(base, "rootless")
        skill(root, "loose", Path("docs"))
        expect_fail(
            root, "a SKILL.md under no skills/ directory fails", "skill-placement"
        )
        expect_pass(
            root,
            "a SKILL.md declared not a skill passes",
            config={"SKILL_FILE_EXEMPT": {"docs/loose/SKILL.md": "a template"}},
        )
        root = valid_tree(base, "nested-root")
        skill(root, "delta", Path("component") / ".claude" / "skills")
        expect_fail(root, "a nested component skills root fails", "one-root")

        # The skills links, in each way they get lost.
        root = valid_tree(base, "link-became-dir")
        (root / CLAUDE_SKILLS).unlink()
        skill(root, "alpha", CLAUDE_SKILLS)
        expect_fail(
            root,
            "a merge that turns the link back into a directory fails",
            "root-links",
        )
        root = valid_tree(base, "absolute-link")
        link(str(root / SKILLS), root / CLAUDE_SKILLS)
        expect_fail(root, "an absolute link fails", "root-links")
        root = valid_tree(base, "wrong-target")
        (root / "elsewhere").mkdir()
        link(os.path.join("..", "elsewhere"), root / CLAUDE_SKILLS)
        expect_fail(root, "a link to somewhere else fails", "root-links")
        root = valid_tree(base, "dangling")
        link(os.path.join("..", "nowhere"), root / ".agents" / "dangling")
        expect_fail(
            root,
            "a dangling symlink in the agent config fails even in audit mode",
            "symlinks",
            mode="audit",
        )
        root = valid_tree(base, "escaping")
        link("/etc", root / ".agents" / "escape")
        expect_fail(root, "a symlink out of the repository fails", "symlinks")
        root = valid_tree(base, "build-link")
        link(
            os.path.join("build", "compile_commands.json"),
            root / "compile_commands.json",
        )
        expect_pass(root, "a dangling link outside the agent config is not the guard's")

        # Git: what it ignores is not judged, what it would hide is.
        root = valid_tree(base, "git-valid")
        git_init(root)
        expect_pass(root, "a committed valid tree passes")
        write(root / ".gitignore", "build/\n.venv/\n")
        link("/etc", root / ".venv" / ".claude" / "escape")
        expect_pass(root, "an escaping symlink in an ignored directory passes")
        root = valid_tree(base, "git-mode")
        git_init(root)
        git(root, "rm", "-q", "--cached", CLAUDE_SKILLS.as_posix())
        git(
            root,
            "update-index",
            "--add",
            "--cacheinfo",
            f"100644,{'e' * 40},{CLAUDE_SKILLS.as_posix()}",
        )
        expect_fail(root, "a link git records as a regular file fails", "root-links")
        root = valid_tree(base, "git-ignored-agents")
        write(root / "tools" / ".gitignore", "AGENTS.md\n")
        write(root / "tools" / "AGENTS.md", "# Tools\n")
        write(root / "tools" / "CLAUDE.md", STUB)
        git_init(root)
        expect_fail(
            root,
            "an AGENTS.md git ignores fails even in audit mode",
            "ignored",
            mode="audit",
        )
        root = valid_tree(base, "git-glob")
        write(root / "docs" / ".gitignore", "*.md\n!CLAUDE.md\n")
        write(root / "docs" / "CLAUDE.md", STUB)
        git_init(root)
        expect_fail(
            root, "a *.md pattern that would hide a stub's AGENTS.md fails", "ignored"
        )
        root = valid_tree(base, "plain-ignore")
        write(root / ".gitignore", "build/\n.agents/\n")
        expect_fail(
            root, "outside git, an ignore pattern for .agents/ still fails", "ignored"
        )
        root = valid_tree(base, "personal")
        write(root / "CLAUDE.local.md", "my own notes\n")
        git_init(root)
        expect_fail(root, "a committed CLAUDE.local.md fails", "personal-files")
        root = valid_tree(base, "submodule")
        skill(root, "Vendored_Bad", Path("vendored") / ".claude" / "skills")
        git_init(root)
        git(root, "rm", "-r", "-q", "--cached", "vendored")
        git(root, "update-index", "--add", "--cacheinfo", f"160000,{'a' * 40},vendored")
        out = expect_pass(root, "a git submodule's skills are excluded")
        report("excluded: vendored" in out, "  ... and the exclusion is printed", out)
        outer = base / "outer"
        root = valid_tree(outer, "inner")
        write(outer / ".gitignore", "scratch/\n")
        skill(root, "Bad_Scratch", Path("scratch") / ".claude" / "skills")
        git_init(outer)
        out = expect_pass(root, "a root inside a git checkout is judged through git")
        report(
            "excluded: paths git ignores" in out,
            "  ... and what git ignores there is excluded",
            out,
        )

        # Adapters, and the stub written through a link.
        root = valid_tree(base, "fat-stub")
        write(root / "CLAUDE.md", STUB + "\nOne more rule.\nAnd another.\n")
        expect_fail(root, "a CLAUDE.md that grew content back fails", "stubs")
        root = valid_tree(base, "stub-no-import")
        write(root / "CLAUDE.md", "# CLAUDE.md\n\nSee AGENTS.md.\n")
        expect_fail(root, "a stub without the import line fails", "stubs")
        root = valid_tree(base, "orphan-stub")
        write(root / "lonely" / "CLAUDE.md", STUB)
        expect_fail(root, "a stub with no AGENTS.md beside it fails", "stubs")
        root = valid_tree(base, "unstubbed")
        write(root / "service" / "AGENTS.md", "# Service\n")
        expect_fail(root, "an AGENTS.md with no CLAUDE.md beside it fails", "stubs")
        root = valid_tree(base, "symlink-adapters")
        link("AGENTS.md", root / "CLAUDE.md")
        link("AGENTS.md", root / "component" / "CLAUDE.md")
        expect_pass(root, "CLAUDE.md as a relative symlink to AGENTS.md passes")
        expect_fail(
            root,
            "the same link fails when the repository chose import stubs",
            "stubs",
            config={"STUB_FORM": "import"},
        )
        root = valid_tree(base, "import-pinned")
        expect_fail(
            root,
            "a stub file fails when the repository chose symlinks",
            "stubs",
            config={"STUB_FORM": "symlink"},
        )
        root = valid_tree(base, "absolute-adapter")
        link(str(root / "AGENTS.md"), root / "CLAUDE.md")
        expect_fail(root, "an absolute CLAUDE.md symlink fails", "stubs")
        root = valid_tree(base, "canonical-link")
        (root / "docs").mkdir()
        (root / "AGENTS.md").rename(root / "docs" / "instructions.md")
        link(os.path.join("docs", "instructions.md"), root / "AGENTS.md")
        expect_fail(
            root, "an AGENTS.md that is a link to the real instructions fails", "stubs"
        )
        root = valid_tree(base, "erased-through-agents-link")
        link("CLAUDE.md", root / "AGENTS.md")
        expect_fail(
            root,
            "a stub written through AGENTS.md -> CLAUDE.md fails even in audit mode",
            "stubs",
            mode="audit",
        )
        root = valid_tree(base, "erased-through-claude-link")
        write(root / "AGENTS.md", STUB)
        link("AGENTS.md", root / "CLAUDE.md")
        expect_fail(
            root,
            "a stub written through CLAUDE.md -> AGENTS.md fails even in audit mode",
            "stubs",
            mode="audit",
        )
        root = valid_tree(base, "gemini-stub")
        write(root / "GEMINI.md", "# GEMINI.md\n\n@AGENTS.md\n")
        expect_pass(root, "a GEMINI.md stub passes")
        expect_fail(
            root,
            "the same stub fails once the repository forbids GEMINI.md",
            "forbidden",
            config={
                "STUB_FILES": {"CLAUDE.md": "@AGENTS.md"},
                "FORBIDDEN_FILES": {"GEMINI.md": "no Gemini adapter"},
            },
        )
        write(root / "GEMINI.md", AGENTS)
        expect_fail(root, "a GEMINI.md copy fails", "stubs")
        root = valid_tree(base, "cursorrules")
        write(root / ".cursorrules", AGENTS)
        expect_fail(root, "a .cursorrules copy fails", "forbidden")

        # Subagents.
        root = valid_tree(base, "agent-unresolved")
        write(
            root / ".claude" / "agents" / "probe.md",
            "---\nname: probe\ndescription: d\nskills:\n  - alpha\n  - vanished\n---\n\nUse alpha.\n",
        )
        expect_fail(
            root,
            "a preload naming a missing skill fails even in audit mode",
            "agent-skills",
            mode="audit",
        )
        root = valid_tree(base, "agent-plugin")
        write(
            root / ".claude" / "agents" / "probe.md",
            "---\nname: probe\ndescription: d\nskills: [alpha, craft:pr-review]\n---\n\nUse alpha.\n",
        )
        out = expect_pass(root, "a plugin-namespaced preload passes")
        report(
            "plugin skill, not checked here" in out,
            "  ... and is named as unchecked",
            out,
        )
        root = valid_tree(base, "agent-fat")
        write(
            root / ".claude" / "agents" / "probe.md",
            "---\nname: probe\ndescription: d\nskills:\n  - alpha\n---\n\n"
            + "A step.\n" * 20,
        )
        expect_fail(
            root, "a subagent body over the envelope cap fails", "agent-envelope"
        )
        root = valid_tree(base, "agent-no-preload")
        write(
            root / ".claude" / "agents" / "probe.md",
            "---\nname: probe\ndescription: d\n---\n\nShort.\n",
        )
        expect_fail(root, "a subagent with no preload fails", "agent-envelope")

        # Citations, links and home paths.
        cited = ".agents/" + "skills/removed/SKILL.md"
        root = valid_tree(base, "citation")
        write(root / "docs" / "guide.md", f"See `{cited}`.\n")
        expect_fail(root, "a citation of a removed skill fails", "citations")
        write(
            root / "docs" / "guide.md",
            f"Recover it with `git show d0907b77:{cited}`.\n",
        )
        expect_pass(root, "a SHA-pinned citation of a removed skill passes")
        write(
            root / "docs" / "guide.md",
            "See `" + ".agents/" + "skills/alpha/SKILL.md`.\n",
        )
        expect_pass(root, "a citation that resolves passes")
        write(root / "docs" / "guide.md", f"See `{cited}`.\n")
        expect_pass(
            root,
            "a declared citation exemption passes",
            config={"CITATION_EXEMPT": {"docs/guide.md": "an example"}},
        )
        write(
            root / "docs" / "guide.md",
            "Personal skills live in `$HOME/.claude/" + "skills/my-skill/`.\n",
        )
        hook = "python3 $CLAUDE_PROJECT_DIR/.claude/" + "skills/nowhere/check.py"
        write(root / ".claude" / "hooks.json", json.dumps({"command": hook}))
        expect_pass(root, "a $VAR-rooted path is not a citation of the repository")
        root = valid_tree(base, "links")
        page = root / SKILLS / "alpha" / "SKILL.md"
        write(root / SKILLS / "alpha" / "references" / "deep.md", "# Deep\n")
        write(
            page,
            page.read_text(encoding="utf-8")
            + "Read [the deep reference](references/deep.md#usage) and [the site](https://example.com).\n"
            + "```markdown\n[a template link](./generated-report.md)\n```\n"
            + "Inline code is not a link: `[x](nowhere.md)`.\n",
        )
        expect_pass(root, "links that resolve, URLs, fenced and inline code all pass")
        write(
            page,
            page.read_text(encoding="utf-8")
            + "Moved: [the old guide](../old-group/guide.md).\n",
        )
        expect_fail(root, "a relative link to a file that moved fails", "links")
        root = valid_tree(base, "home")
        write(
            root / SKILLS / "alpha" / "notes.md",
            "Run " + "/Users/" + "alice/tools/fmt.sh first.\n",
        )
        expect_warn(
            root,
            "a path into someone's home directory is a warning in every mode",
            "home-paths",
            mode="enforce",
        )
        write(root / SKILLS / "alpha" / "notes.md", "Clone it to /Users/you/src.\n")
        expect_pass(root, "a placeholder home directory passes")

        # Settings stated in prose, so agents without the mechanism follow them too.
        root = valid_tree(base, "env-drift")
        write(
            root / "AGENTS.md",
            AGENTS.replace("RUN_JOBS=8", "RUN_JOBS=4") + "Never run `sudo`.\n",
        )
        expect_fail(
            root,
            "a documented env value that differs from settings.json fails",
            "settings-env",
        )
        root = valid_tree(base, "deny-unstated")
        write(root / "AGENTS.md", AGENTS)
        expect_fail(
            root,
            "a denied command the instruction file never names fails",
            "settings-deny",
        )
        root = valid_tree(base, "settings-list")
        write(root / ".claude" / "settings.json", "[]\n")
        expect_fail(
            root,
            "a settings.json that is not an object fails, without a crash",
            "settings",
            mode="audit",
        )

        # Size: the cap Codex truncates at without a word, and the chain it applies it to.
        root = valid_tree(base, "oversized")
        write(
            root / "AGENTS.md", AGENTS + "Never run `sudo`.\n" + "filler line\n" * 3000
        )
        expect_fail(root, "an AGENTS.md over 32 KiB fails", "size")
        root = valid_tree(base, "chain")
        write(
            root / "AGENTS.md", AGENTS + "Never run `sudo`.\n" + "root filler\n" * 1500
        )
        write(
            root / "component" / "AGENTS.md",
            "# Component\n" + "component filler\n" * 1200,
        )
        code, out = run(root)
        report(
            code == 0 and "warn  chain" in out and "component/" in out,
            "an over-cap chain is a warning that names the directory, not a failure",
            out,
        )
        root = valid_tree(base, "dangling-agents")
        link("nowhere.md", root / "AGENTS.md")
        expect_fail(root, "a dangling AGENTS.md is reported, not a crash", "symlinks")

        # Exclusions are printed and exclude.
        root = valid_tree(base, "vendored")
        skill(
            root,
            "Vendor_Skill",
            Path("web") / "node_modules" / "pkg" / ".claude" / "skills",
        )
        out = expect_pass(root, "a node_modules skill is excluded")
        report(
            "excluded: node_modules/" in out, "  ... and the exclusion is printed", out
        )

        # Configuration.
        root = base / "claude-only"
        skill(root, "alpha", CLAUDE_SKILLS)
        write(root / "AGENTS.md", AGENTS)
        write(root / "CLAUDE.md", STUB)
        expect_pass(
            root,
            "a Claude Code-only layout passes when configured",
            config={
                "CANONICAL_SKILLS_ROOT": CLAUDE_SKILLS.as_posix(),
                "SKILL_ROOT_LINKS": [],
            },
        )
        for label, bad in (
            ("unknown", {"NO_SUCH_SETTING": 1}),
            ("string-for-list", {"SKILL_ROOT_LINKS": CLAUDE_SKILLS.as_posix()}),
            ("bool-for-int", {"AGENT_BODY_MAX_LINES": True}),
            ("bad-form", {"STUB_FORM": "hardlink"}),
        ):
            code, out = run(valid_tree(base, f"config-{label}"), config=bad)
            report(
                code == 2 and "Traceback" not in out,
                f"a bad --config ({label}) exits 2",
                out,
            )

    print(f"\n{_failures} failing case(s)" if _failures else "\nAll cases passed")
    return 1 if _failures else 0


if __name__ == "__main__":
    sys.exit(main())
