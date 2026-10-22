#!/usr/bin/env python3
"""Inventory a repository's agent configuration, read-only, as Markdown or JSON.

Lists every instruction file, skills root, skill, subagent, command, rule,
settings, hook and MCP file an agent might read, with sizes, frontmatter,
symlinks, near-duplicate content, AGENTS.md chain sizes and the findings a
migration to one canonical source has to clear. With the machine section on
(the default), it also names local skills that an installed Claude Code plugin
or a user-level skills directory already provides.

The inventory says what is on disk; only a probe of each agent says what it
loads (references/runtimes.md). The two differ exactly where the defects are.

Run: python3 inventory.py [--root DIR] [--json] [--no-machine]
Python 3.9+, standard library only. Shares its file model and frontmatter
parser with check_agent_config.py, which sits beside it.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path, PurePosixPath

# Import the sibling guard without writing __pycache__ into the skill's directory.
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_agent_config as guard  # noqa: E402  (the sibling module, found by the line above)

# Instruction files by name: name -> the agent that conventionally reads it.
INSTRUCTION_NAMES = {
    "AGENTS.md": "most agents (agents.md)",
    "CLAUDE.md": "Claude Code",
    "CLAUDE.local.md": "Claude Code, personal",
    "GEMINI.md": "Gemini CLI",
    "AGENT.md": "Amp (legacy name)",
    ".cursorrules": "Cursor (legacy)",
    ".windsurfrules": "Windsurf (legacy)",
    "CONVENTIONS.md": "Aider (with --read)",
}
# Instruction files by location: path prefix -> reader.
INSTRUCTION_PREFIXES = {
    ".claude/rules/": "Claude Code",
    ".cursor/rules/": "Cursor",
    ".github/copilot-instructions.md": "GitHub Copilot",
    ".github/instructions/": "GitHub Copilot",
    ".windsurf/rules/": "Windsurf",
    ".clinerules": "Cline",
    ".roo/": "Roo Code",
    ".kiro/steering/": "Kiro",
    ".junie/guidelines.md": "Junie",
    ".amazonq/rules/": "Amazon Q",
    ".continue/rules/": "Continue",
    ".rules": "Zed",
}
AGENT_DIRS = (".claude/agents", ".gemini/agents", ".github/agents")
COMMAND_DIRS = (
    ".claude/commands",
    ".gemini/commands",
    ".cursor/commands",
    ".codex/prompts",
)
CONFIG_FILES = {
    ".claude/settings.json": "Claude Code project settings",
    ".claude/settings.local.json": "Claude Code personal settings",
    ".mcp.json": "Claude Code MCP servers",
    ".codex/config.toml": "Codex project config",
    ".gemini/settings.json": "Gemini CLI settings",
    ".cursor/mcp.json": "Cursor MCP servers",
    ".cursor/hooks.json": "Cursor hooks",
    ".vscode/mcp.json": "VS Code MCP servers",
    ".agents/hooks.json": "Antigravity hooks",
    ".claude-plugin/plugin.json": "Claude Code plugin manifest",
    ".claude-plugin/marketplace.json": "Claude Code marketplace manifest",
}
MIN_LINE = 25
MIN_SHARED = 5
MIN_OVERLAP = 0.3
CATALOG_THRESHOLD = 5


def reader_of(rel: str) -> str | None:
    name = PurePosixPath(rel).name
    if name in INSTRUCTION_NAMES:
        return INSTRUCTION_NAMES[name]
    for prefix, reader in INSTRUCTION_PREFIXES.items():
        if (
            rel == prefix
            or (prefix.endswith("/") and rel.startswith(prefix))
            or rel.startswith(prefix + "/")
        ):
            return reader
    return None


def significant_lines(text: str) -> set[str]:
    lines = set()
    for line in text.splitlines():
        normal = " ".join(line.strip().lower().split())
        if len(normal) >= MIN_LINE and not normal.startswith(
            ("```", "---", "|-", "| -")
        ):
            lines.add(normal)
    return lines


def overlaps(docs: dict[str, set[str]]) -> list[dict]:
    index: dict[str, list[str]] = {}
    for rel, lines in docs.items():
        for line in lines:
            index.setdefault(line, []).append(rel)
    shared: dict[tuple[str, str], int] = {}
    for holders in index.values():
        if len(holders) > 20:
            continue  # boilerplate every file carries
        for i, a in enumerate(holders):
            for b in holders[i + 1 :]:
                key = (a, b) if a < b else (b, a)
                shared[key] = shared.get(key, 0) + 1
    pairs = []
    for (a, b), count in shared.items():
        smaller = min(len(docs[a]), len(docs[b])) or 1
        if count >= MIN_SHARED and count / smaller >= MIN_OVERLAP:
            pairs.append(
                {
                    "a": a,
                    "b": b,
                    "shared_lines": count,
                    "overlap": round(count / smaller, 2),
                }
            )
    return sorted(pairs, key=lambda p: (-p["shared_lines"], p["a"]))


def body_lines(text: str) -> int:
    _, body = guard.split_frontmatter(text)
    return sum(1 for line in body.splitlines() if line.strip())


def summarize_config(repo: guard.Repo, rel: str) -> str:
    text = repo.read(rel)
    if rel.endswith(".toml"):
        sections = sorted(set(re.findall(r"^\s*\[+([^\]]+)\]", text, re.MULTILINE)))
        return "sections: " + (", ".join(sections) or "none")
    try:
        data = json.loads(text)
    except ValueError:
        return "does not parse as JSON"
    if not isinstance(data, dict):
        return "not a JSON object"
    parts = []
    if isinstance(data.get("env"), dict):
        parts.append("env: " + ", ".join(sorted(data["env"])))
    permissions = data.get("permissions") or {}
    for kind in ("allow", "ask", "deny"):
        if permissions.get(kind):
            parts.append(f"{len(permissions[kind])} {kind}")
    hooks = data.get("hooks") or {}
    if isinstance(hooks, dict) and hooks:
        counts = {
            event: sum(
                len(group.get("hooks", []))
                for group in groups
                if isinstance(group, dict)
            )
            for event, groups in hooks.items()
            if isinstance(groups, list)
        }
        parts.append(
            "hooks: "
            + ", ".join(f"{event} ({n})" for event, n in sorted(counts.items()))
        )
    for key in ("mcpServers", "servers"):
        if isinstance(data.get(key), dict):
            parts.append("MCP: " + ", ".join(sorted(data[key])))
    if isinstance(data.get("enabledPlugins"), dict):
        enabled = [name for name, on in data["enabledPlugins"].items() if on]
        parts.append("plugins: " + ", ".join(sorted(enabled)))
    if isinstance(data.get("context"), dict) and data["context"].get("fileName"):
        parts.append(f"context.fileName: {data['context']['fileName']}")
    if isinstance(data.get("plugins"), list):
        parts.append(f"{len(data['plugins'])} plugin(s)")
    return "; ".join(parts) or "keys: " + ", ".join(sorted(data))


def skill_names_in(text: str, names: set[str]) -> set[str]:
    return {
        n
        for n in names
        if len(n) > 3 and re.search(rf"(?<![\w-]){re.escape(n)}(?![\w-])", text)
    }


def machine_skills() -> dict[str, list[dict]]:
    """Skills this machine provides outside the repository: plugins and user directories."""
    home = Path.home()
    config_dir = Path(os.environ.get("CLAUDE_CONFIG_DIR", home / ".claude"))
    found: dict[str, list[dict]] = {}

    def add(name: str, source: str, path: Path) -> None:
        found.setdefault(name, []).append({"source": source, "path": str(path)})

    for directory, label in (
        (config_dir / "skills", "user ~/.claude/skills"),
        (home / ".agents" / "skills", "user ~/.agents/skills"),
        (home / ".codex" / "skills", "user ~/.codex/skills"),
        (home / ".gemini" / "skills", "user ~/.gemini/skills"),
    ):
        for skill_md in sorted(directory.glob("*/SKILL.md")):
            add(skill_md.parent.name, label, skill_md)
    try:
        installed = json.loads(
            (config_dir / "plugins" / "installed_plugins.json").read_text(
                encoding="utf-8"
            )
        )
    except (OSError, ValueError):
        installed = {}
    for key, listed in (installed.get("plugins") or {}).items():
        plugin = key.split("@", 1)[0]
        # One entry per scope and project; the most recently updated install is the one in use.
        entries = (
            [e for e in listed if isinstance(e, dict)]
            if isinstance(listed, list)
            else []
        )
        if not entries:
            continue
        latest = max(entries, key=lambda e: str(e.get("lastUpdated", "")))
        install = Path(str(latest.get("installPath", "")))
        for skill_md in sorted(install.glob("skills/*/SKILL.md")):
            add(
                skill_md.parent.name,
                f"plugin {plugin}:{skill_md.parent.name} ({key})",
                skill_md,
            )
    return found


def build(repo: guard.Repo, with_machine: bool) -> dict:
    skills = guard.collect_skills(repo)
    data: dict = {
        "root": str(repo.root),
        "git": None,
        "instruction_files": [],
        "chains": [],
        "skill_roots": [],
        "skills": [],
        "agents": [],
        "commands": [],
        "configs": [],
        "duplicates": [],
        "findings": [],
        "machine": None,
    }
    if repo.git:
        head = (
            guard.run_git(repo.root, "rev-parse", "--abbrev-ref", "HEAD") or ""
        ).strip()
        sha = (guard.run_git(repo.root, "rev-parse", "--short", "HEAD") or "").strip()
        data["git"] = {"branch": head, "commit": sha, "submodules": repo.submodules}
    findings = data["findings"]

    def finding(kind: str, text: str, phase: str) -> None:
        findings.append({"kind": kind, "text": text, "phase": phase})

    # Instruction files.
    instructions = []
    for rel in repo.files:
        reader = reader_of(rel)
        if reader is None:
            continue
        path = repo.root / rel
        text = repo.read(rel)
        notes = []
        if path.is_symlink():
            notes.append(f"symlink -> {os.readlink(path)}")
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        imports = [line for line in lines if line.startswith("@")]
        if imports and len(lines) <= guard.STUB_MAX_LINES:
            notes.append("stub: " + ", ".join(imports))
        elif imports:
            notes.append("imports: " + ", ".join(imports))
        size = path.stat().st_size if path.is_file() else 0
        if size >= guard.INSTRUCTIONS_MAX_BYTES:
            notes.append("over 32 KiB")
        if repo.git and rel not in repo.tracked:
            notes.append("untracked")
        instructions.append(
            {
                "path": rel,
                "bytes": size,
                "lines": text.count("\n") + bool(text),
                "reader": reader,
                "notes": notes,
                "link": os.readlink(path) if path.is_symlink() else None,
            }
        )
    data["instruction_files"] = instructions
    if repo.git:
        for directory in sorted(
            {""} | {PurePosixPath(p).parent.as_posix() for p in repo.files} - {"."}
        ):
            for name in ("AGENTS.md", "CLAUDE.md", "GEMINI.md"):
                rel = f"{directory}/{name}" if directory else name
                if (
                    rel not in repo.file_set
                    and (repo.root / rel).is_file()
                    and not repo.excluded(rel)
                ):
                    finding(
                        "ignored",
                        f"{rel} exists but git ignores it: written, never shared",
                        "4 (components)",
                    )

    by_dir: dict[str, dict[str, dict]] = {}
    for item in instructions:
        by_dir.setdefault(PurePosixPath(item["path"]).parent.as_posix(), {})[
            PurePosixPath(item["path"]).name
        ] = item

    def adapter(item: dict | None) -> bool:
        return bool(item) and (
            item["link"] is not None or any(n.startswith("stub") for n in item["notes"])
        )

    for directory, files in sorted(by_dir.items()):
        agents_md, claude_md = files.get("AGENTS.md"), files.get("CLAUDE.md")
        where = "" if directory == "." else f"{directory}/"
        if agents_md and agents_md["link"]:
            finding(
                "link",
                f"{where}AGENTS.md is a symlink to {agents_md['link']}, so the instructions live "
                f"there: `git rm {where}AGENTS.md` (the link) before any `git mv`, because a stub written "
                "through a link overwrites the file it points at",
                "2 (canonical instructions)",
            )
        elif claude_md and not adapter(claude_md):
            if agents_md:
                finding(
                    "copy",
                    f"{where}CLAUDE.md ({claude_md['bytes']} B) and {where}AGENTS.md "
                    f"({agents_md['bytes']} B) both hold instructions",
                    "2 (canonical instructions)",
                )
            else:
                finding(
                    "claude-only",
                    f"{where}CLAUDE.md ({claude_md['bytes']} B) is read by Claude Code only",
                    "2 (canonical instructions)" if not where else "4 (components)",
                )
        if agents_md and not claude_md:
            finding(
                "unstubbed",
                f"{where}AGENTS.md has no CLAUDE.md beside it (a symlink to it, or a stub "
                "importing it); Claude Code reads it only through one, or through its built-in reader "
                "when no CLAUDE.md sits above",
                "4 (components)",
            )
        for name in ("GEMINI.md", ".cursorrules", ".windsurfrules", "AGENT.md"):
            if name in files and not adapter(files[name]):
                finding(
                    "copy",
                    f"{where}{name} is a per-agent copy of the instructions",
                    "7 (adapters)",
                )
    for item in instructions:
        name = PurePosixPath(item["path"]).name
        if item["link"] or item["bytes"] < guard.INSTRUCTIONS_MAX_BYTES:
            continue
        if name == "AGENTS.md":
            finding(
                "size",
                f"{item['path']} is {item['bytes']} bytes; Codex drops whatever lies past "
                "32 KiB, silently",
                "2 (canonical instructions)",
            )
        elif name == "CLAUDE.md":
            finding(
                "size",
                f"{item['path']} is {item['bytes']} bytes; as AGENTS.md it must shed to under "
                "32 KiB, where Codex truncates",
                "2 (canonical instructions)",
            )

    # AGENTS.md chains, which Codex concatenates root first and truncates at the end.
    root_size = (
        (repo.root / "AGENTS.md").stat().st_size
        if (repo.root / "AGENTS.md").is_file()
        else 0
    )
    nested = [
        p
        for p in repo.named("AGENTS.md")
        if p != "AGENTS.md" and (repo.root / p).is_file()
    ]
    for rel in nested:
        directory = PurePosixPath(rel).parent
        chain = [
            p
            for p in nested
            if PurePosixPath(p).parent in (directory, *directory.parents)
        ]
        total = root_size + sum((repo.root / p).stat().st_size for p in chain)
        data["chains"].append(
            {
                "directory": str(directory),
                "bytes": total,
                "over": max(0, total - guard.INSTRUCTIONS_MAX_BYTES),
            }
        )
        if total >= guard.INSTRUCTIONS_MAX_BYTES:
            finding(
                "chain",
                f"{directory}/: AGENTS.md chain is {total} bytes; a Codex session started there "
                f"loses the end of {rel}",
                "10 (size by chain)",
            )

    # Skills roots, real and linked.
    roots: dict[str, dict] = {}
    for skill in skills:
        if skill.root is None:
            continue
        entry = roots.setdefault(
            skill.root,
            {"root": skill.root, "kind": "directory", "skills": 0, "nested": 0},
        )
        entry["skills" if skill.depth == 1 else "nested"] += 1
    for rel in repo.files:
        if PurePosixPath(rel).name == "skills" and (repo.root / rel).is_symlink():
            roots[rel] = {
                "root": rel,
                "kind": f"symlink -> {os.readlink(repo.root / rel)}",
                "skills": None,
                "nested": None,
            }
    data["skill_roots"] = sorted(roots.values(), key=lambda r: r["root"])
    real_roots = [r["root"] for r in data["skill_roots"] if r["kind"] == "directory"]
    if len(real_roots) > 1:
        finding(
            "roots",
            f"{len(real_roots)} real skills roots ({', '.join(real_roots)}); a nested root "
            "exists only for sessions started inside it",
            "6 (one root)",
        )

    # Skills.
    local_names = set()
    for skill in skills:
        fields = skill.fields or {}
        name = str(fields.get("name", ""))
        description = str(fields.get("description", ""))
        skill_dir = PurePosixPath(skill.path).parent.as_posix()
        issues = []
        if skill.fields is None:
            issues.append("no frontmatter")
        if name and name != skill.dirname:
            issues.append(f"name {name!r} != directory")
        if not guard.SKILL_NAME_RE.match(skill.dirname):
            issues.append("name grammar")
        if not description:
            issues.append("no description")
        elif len(description) > guard.DESCRIPTION_MAX:
            issues.append(f"description {len(description)} chars")
        if skill.root is None:
            issues.append("under no skills/ directory")
        elif skill.depth != 1:
            issues.append(f"depth {skill.depth}: Claude Code does not load it")
        local_names.add(skill.dirname)
        data["skills"].append(
            {
                "skill": skill.dirname,
                "path": skill.path,
                "root": skill.root,
                "frontmatter_name": name,
                "description_chars": len(description),
                "paths": bool(fields.get("paths")),
                "files": len(repo.under(skill_dir)),
                "skill_md_lines": repo.read(skill.path).count("\n"),
                "issues": issues,
            }
        )
    invisible = [
        s["path"]
        for s in data["skills"]
        if any(i.startswith("depth") for i in s["issues"])
    ]
    if invisible:
        finding(
            "nested",
            f"{len(invisible)} SKILL.md nested below <root>/<name>/, invisible to Claude Code "
            f"(e.g. {invisible[0]})",
            "5 (nested skills)",
        )
    drift = [
        s["path"]
        for s in data["skills"]
        if any("!= directory" in i for i in s["issues"])
    ]
    if drift:
        finding(
            "drift",
            f"{len(drift)} skill(s) whose frontmatter name differs from the directory "
            f"(e.g. {drift[0]})",
            "5 (nested skills)",
        )

    # Subagents, commands, rules.
    for directory in AGENT_DIRS:
        for rel in repo.under(directory):
            if not rel.endswith(".md"):
                continue
            text = repo.read(rel)
            fields, _ = guard.split_frontmatter(text)
            fields = fields or {}
            body = body_lines(text)
            preload = guard.as_list(fields.get("skills"))
            data["agents"].append(
                {
                    "path": rel,
                    "body_lines": body,
                    "skills": preload,
                    "tools": str(fields.get("tools", "")),
                    "model": str(fields.get("model", "")),
                }
            )
            if body > guard.AGENT_BODY_MAX_LINES:
                finding(
                    "agent",
                    f"{rel}: {body} body lines of procedure only this agent's runtime reads",
                    "8 (envelopes)",
                )
    for directory in COMMAND_DIRS:
        for rel in repo.under(directory):
            data["commands"].append({"path": rel, "lines": repo.read(rel).count("\n")})
    if data["commands"]:
        finding(
            "commands",
            f"{len(data['commands'])} command file(s): each is a procedure that could be a "
            "skill every agent reads",
            "8 (envelopes)",
        )

    # Settings, hooks, MCP.
    for rel, what in CONFIG_FILES.items():
        if rel in repo.file_set or (repo.root / rel).is_file():
            tracked = (not repo.git) or rel in repo.tracked
            data["configs"].append(
                {
                    "path": rel,
                    "what": what,
                    "summary": summarize_config(repo, rel),
                    "tracked": tracked,
                }
            )
            if rel.endswith("settings.local.json") and repo.git and tracked:
                finding(
                    "personal",
                    f"{rel} is committed: one person's permissions in everyone's checkout",
                    "9 (outside skills)",
                )
    try:
        settings = json.loads(repo.read(".claude/settings.json") or "{}")
    except ValueError:
        settings = {}
    prefixes, _ = guard.deny_prefixes(settings if isinstance(settings, dict) else {})
    prose = repo.read("AGENTS.md") or repo.read("CLAUDE.md")
    unstated = [p for p in prefixes if f"`{p}`" not in prose]
    if unstated:
        finding(
            "settings",
            f"{len(unstated)} of {len(prefixes)} denied command(s) in .claude/settings.json "
            f"are not named in AGENTS.md (e.g. `{unstated[0]}`), so other agents never hear the rule",
            "9 (outside skills)",
        )

    # Duplicated content and hand-maintained catalogs.
    docs = {}
    for item in instructions:
        if not item["link"]:  # a link and its target are one file, not a copy
            docs[item["path"]] = significant_lines(repo.read(item["path"]))
    for skill in skills:
        for rel in repo.under(PurePosixPath(skill.path).parent.as_posix()):
            if rel.endswith((".md", ".mdc")):
                docs[rel] = significant_lines(repo.read(rel))
    for agent in data["agents"]:
        docs[agent["path"]] = significant_lines(repo.read(agent["path"]))
    data["duplicates"] = overlaps(docs)[:40]
    skill_files = {
        rel
        for skill in skills
        for rel in repo.under(PurePosixPath(skill.path).parent.as_posix())
    }
    for pair in data["duplicates"][:5]:
        both_skills = pair["a"] in skill_files and pair["b"] in skill_files
        finding(
            "duplicate",
            f"{pair['a']} and {pair['b']} share {pair['shared_lines']} lines "
            f"({int(pair['overlap'] * 100)}% of the smaller)",
            "5 (nested skills)" if both_skills else "2 (canonical instructions)",
        )
    for item in instructions:
        named = skill_names_in(repo.read(item["path"]), local_names)
        if len(named) >= CATALOG_THRESHOLD and not item["link"]:
            finding(
                "catalog",
                f"{item['path']} names {len(named)} skills: a hand-kept catalog drifts, and "
                "the loader already lists them",
                "2 (canonical instructions)",
            )

    # Home paths.
    placeholders = {h.lower() for h in guard.HOME_PLACEHOLDERS}
    homes = set()
    for rel in guard.instruction_files(repo, skills):
        for pattern in guard.HOME_PATH_RES:
            for match in pattern.finditer(repo.read(rel)):
                if match.group(1).lower() not in placeholders:
                    homes.add(rel)
    if homes:
        finding(
            "home",
            f"{len(homes)} instruction file(s) point into someone's home directory "
            f"(e.g. {sorted(homes)[0]})",
            "5 (nested skills)",
        )

    if with_machine:
        provided = machine_skills()
        collisions = []
        for name in sorted(local_names & set(provided)):
            local = next(s for s in data["skills"] if s["skill"] == name)
            local_lines = significant_lines(repo.read(local["path"]))
            for source in provided[name]:
                try:
                    other = significant_lines(
                        Path(source["path"]).read_text(encoding="utf-8")
                    )
                except (OSError, UnicodeDecodeError):
                    other = set()
                smaller = min(len(local_lines), len(other)) or 1
                collisions.append(
                    {
                        "skill": name,
                        "local": local["path"],
                        "also_in": source["source"],
                        "overlap": round(len(local_lines & other) / smaller, 2),
                    }
                )
        data["machine"] = {"collisions": collisions, "provided": len(provided)}
        if collisions:
            finding(
                "plugin",
                f"{len(collisions)} local skill(s) also provided on this machine "
                f"(e.g. {collisions[0]['skill']} by {collisions[0]['also_in']}): compare, move the "
                "repository's own facts out, then delete the copy",
                "shared plugin",
            )
    return data


def table(headers: list[str], rows: list[list[object]]) -> str:
    def cell(value: object) -> str:
        return str(value).replace("|", "\\|").replace("\n", " ")

    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    lines += ["| " + " | ".join(cell(v) for v in row) + " |" for row in rows]
    return "\n".join(lines)


def render(data: dict) -> str:
    out = ["# Agent configuration inventory", "", f"Root: `{data['root']}`"]
    if data["git"]:
        git = data["git"]
        out.append(
            f"Git: `{git['branch']}` at `{git['commit']}`"
            + (
                f"; submodules excluded: {', '.join(git['submodules'])}"
                if git["submodules"]
                else ""
            )
        )
    out.append("")
    out.append(
        f"{len(data['instruction_files'])} instruction file(s), {len(data['skills'])} SKILL.md, "
        f"{len(data['agents'])} subagent(s), {len(data['commands'])} command(s), "
        f"{len(data['configs'])} settings/MCP file(s)."
    )

    out += ["", "## Findings", ""]
    if data["findings"]:
        out.append(
            table(
                ["Kind", "Finding", "Phase"],
                [[f["kind"], f["text"], f["phase"]] for f in data["findings"]],
            )
        )
    else:
        out.append(
            "None: the layout already looks canonical. Run check_agent_config.py to be sure."
        )

    out += ["", "## Instruction files", ""]
    out.append(
        table(
            ["Path", "Bytes", "Lines", "Read by", "Notes"],
            [
                [
                    f"`{f['path']}`",
                    f["bytes"],
                    f["lines"],
                    f["reader"],
                    "; ".join(f["notes"]),
                ]
                for f in data["instruction_files"]
            ],
        )
        if data["instruction_files"]
        else "None."
    )
    if data["chains"]:
        out += [
            "",
            "### AGENTS.md chains (root plus each file down to the directory)",
            "",
        ]
        out.append(
            table(
                ["Directory", "Chain bytes", "Over 32 KiB by"],
                [
                    [f"`{c['directory']}/`", c["bytes"], c["over"] or ""]
                    for c in data["chains"]
                ],
            )
        )

    out += ["", "## Skills roots", ""]
    out.append(
        table(
            ["Root", "Kind", "Skills at <root>/<name>/", "Nested deeper"],
            [
                [
                    f"`{r['root']}`",
                    r["kind"],
                    r["skills"] if r["skills"] is not None else "",
                    r["nested"] if r["nested"] is not None else "",
                ]
                for r in data["skill_roots"]
            ],
        )
        if data["skill_roots"]
        else "None."
    )

    out += ["", "## Skills", ""]
    out.append(
        table(
            ["Skill", "Path", "Desc. chars", "paths:", "Files", "Issues"],
            [
                [
                    s["skill"],
                    f"`{s['path']}`",
                    s["description_chars"],
                    "yes" if s["paths"] else "",
                    s["files"],
                    "; ".join(s["issues"]),
                ]
                for s in data["skills"]
            ],
        )
        if data["skills"]
        else "None."
    )

    if data["agents"] or data["commands"]:
        out += ["", "## Subagents and commands", ""]
        rows = [
            [
                f"`{a['path']}`",
                "subagent",
                a["body_lines"],
                ", ".join(a["skills"]),
                a["tools"],
                a["model"],
            ]
            for a in data["agents"]
        ]
        rows += [
            [f"`{c['path']}`", "command", c["lines"], "", "", ""]
            for c in data["commands"]
        ]
        out.append(
            table(["Path", "Kind", "Body lines", "skills:", "tools", "model"], rows)
        )

    out += ["", "## Settings, hooks and MCP", ""]
    out.append(
        table(
            ["Path", "What", "Summary", "Tracked"],
            [
                [
                    f"`{c['path']}`",
                    c["what"],
                    c["summary"],
                    "yes" if c["tracked"] else "no",
                ]
                for c in data["configs"]
            ],
        )
        if data["configs"]
        else "None."
    )

    out += ["", "## Duplicated content", ""]
    out.append(
        table(
            ["File A", "File B", "Shared lines", "Overlap"],
            [
                [
                    f"`{d['a']}`",
                    f"`{d['b']}`",
                    d["shared_lines"],
                    f"{int(d['overlap'] * 100)}%",
                ]
                for d in data["duplicates"]
            ],
        )
        if data["duplicates"]
        else f"No file pair shares {MIN_SHARED}+ substantial lines."
    )

    if data["machine"] is not None:
        out += [
            "",
            "## On this machine",
            "",
            f"{data['machine']['provided']} skill name(s) provided outside the repository "
            "(plugins, user skills directories).",
        ]
        if data["machine"]["collisions"]:
            out += [
                "",
                table(
                    ["Skill", "Local copy", "Also provided by", "Overlap"],
                    [
                        [
                            c["skill"],
                            f"`{c['local']}`",
                            c["also_in"],
                            f"{int(c['overlap'] * 100)}%",
                        ]
                        for c in data["machine"]["collisions"]
                    ],
                ),
            ]
    return "\n".join(out) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="repository root (default: the git top level of the current directory)",
    )
    parser.add_argument(
        "--json", action="store_true", help="print JSON instead of Markdown"
    )
    parser.add_argument(
        "--no-machine",
        action="store_true",
        help="skip the plugins and user skills installed on this machine",
    )
    args = parser.parse_args()
    root = args.root
    if root is None:
        toplevel = guard.run_git(Path.cwd(), "rev-parse", "--show-toplevel")
        root = Path(toplevel.strip()) if toplevel else Path.cwd()
    root = root.resolve()
    if not root.is_dir():
        print(f"inventory: {root} is not a directory", file=sys.stderr)
        return 2
    data = build(guard.Repo(root), with_machine=not args.no_machine)
    print(
        json.dumps(data, indent=2, sort_keys=True) if args.json else render(data),
        end="",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
