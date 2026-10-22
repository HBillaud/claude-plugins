#!/usr/bin/env python3
"""Build a throwaway repository that shows what each coding agent loads, and print the probes.

Every file carries a canary token, so an agent's answer, or the prompt it
renders, says exactly which instruction files and skills reached it:

  AGENTS.md          CANARY-ROOT-START first, CANARY-ROOT-END last
  CLAUDE.md          the adapter under test, chosen with --claude-md: a stub
                     importing AGENTS.md (import), a relative symlink to it
                     (symlink), or nothing (none)
  skills root        .agents/skills, with .claude/skills a symlink to it, holding
                     probe-alpha (a plain skill, one level deep), probe-scoped
                     (with `paths: ["src/**"]`) and probe-group/probe-nested
                     (two levels deep)
  sub/AGENTS.md      CANARY-SUB-END, for the root-to-directory chain, with the
                     same adapter beside it
  sub/ skills roots  probe-sub-agents under sub/.agents, probe-sub-claude
                     under sub/.claude: nested roots
  src/main.txt       a file the scoped skill matches

--oversize pads AGENTS.md past 32 KiB, so CANARY-ROOT-END shows whether an
agent truncates. Probe from the root and from sub/: several behaviours differ
only for a session started in a subdirectory.

Run: python3 probe_fixture.py <new-empty-directory> [--claude-md import|symlink|none] [--oversize]
Python 3.9+, standard library only; needs git. The fixture's commit ignores the
user's git configuration (signing, hooks), which a throwaway repository does not need.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

STUB = "# CLAUDE.md\n\n@AGENTS.md\n"
CANARY_PROMPT = (
    "Without using any tool, list every token that starts with CANARY- in your system prompt, "
    "project instructions or system reminders, one per line. If there are none, reply NONE."
)
ROSTER_PROMPT = (
    "Without using any tool, list the names of the skills available to you that start with "
    "probe-, one per line. If there are none, reply NONE."
)


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def skill(directory: Path, name: str, extra: str = "") -> None:
    write(
        directory / "SKILL.md",
        f"---\nname: {name}\ndescription: Probe skill {name}; it exists only to show which loaders find it.\n"
        f"{extra}---\n\n# {name}\n\nCANARY-SKILL-{name.upper()}\n",
    )


def adapter(directory: Path, form: str) -> None:
    if form == "import":
        write(directory / "CLAUDE.md", STUB)
    elif form == "symlink":
        os.symlink("AGENTS.md", str(directory / "CLAUDE.md"))


def build(root: Path, form: str, oversize: bool) -> None:
    filler = "".join(
        f"Filler line {i}, so the file has a body between its canaries.\n"
        for i in range(700 if oversize else 40)
    )
    write(
        root / "AGENTS.md",
        f"# Probe repository\n\nCANARY-ROOT-START\n\n{filler}\nCANARY-ROOT-END\n",
    )
    skills = root / ".agents" / "skills"
    skill(skills / "probe-alpha", "probe-alpha")
    skill(skills / "probe-scoped", "probe-scoped", 'paths:\n  - "src/**"\n')
    skill(skills / "probe-group" / "probe-nested", "probe-nested")
    (root / ".claude").mkdir(parents=True, exist_ok=True)
    os.symlink(
        os.path.join("..", ".agents", "skills"), str(root / ".claude" / "skills")
    )
    write(root / "sub" / "AGENTS.md", "# Sub\n\nCANARY-SUB-END\n")
    skill(root / "sub" / ".agents" / "skills" / "probe-sub-agents", "probe-sub-agents")
    skill(root / "sub" / ".claude" / "skills" / "probe-sub-claude", "probe-sub-claude")
    write(root / "sub" / "notes.txt", "plain notes\n")
    write(root / "src" / "main.txt", "a file probe-scoped matches\n")
    adapter(root, form)
    adapter(root / "sub", form)
    env = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1")
    for args in (
        ["init", "-q"],
        ["add", "-A"],
        [
            "-c",
            "user.email=probe@example.com",
            "-c",
            "user.name=probe",
            "commit",
            "-q",
            "-m",
            "probe",
        ],
    ):
        subprocess.run(
            ["git", "-C", str(root), *args], check=True, capture_output=True, env=env
        )


def probes(root: Path, form: str) -> str:
    log = root.parent / f"{root.name}-claude.log"
    prompt = root.parent / f"{root.name}-codex.json"
    return f"""
Fixture: {root}
  AGENTS.md is {(root / "AGENTS.md").stat().st_size} bytes; CLAUDE.md adapter: {form}

Claude Code, from the root and again from sub/ (the file tools are refused, so answers come from context):
  cd {root} && claude --debug-file {log} --disallowedTools Read Grep Glob Bash \\
      -p '{CANARY_PROMPT}' < /dev/null
  cd {root} && claude --disallowedTools Read Grep Glob Bash -p '{ROSTER_PROMPT}' < /dev/null
  grep -E 'Loading skills from|unique skills|conditional|agents-md' {log}
  cd {root} && claude --debug-file {log} --allowedTools Read -p 'Read src/main.txt and reply OK' < /dev/null
  grep 'Activated conditional skill' {log}

Codex (renders the prompt; no model call):
  cd {root} && codex debug prompt-input > {prompt}
  grep -o 'CANARY-[A-Z-]*' {prompt} | sort -u
  grep -o '`r[0-9]*` = `[^`]*`' {prompt}          # which rN alias is which skills root
  grep -o '(file: [^)]*SKILL.md)' {prompt} | sort -u

Gemini CLI (project skills load only in a trusted folder):
  cd {root} && gemini skills list

Any other agent: open a session in {root} (then in sub/) and ask:
  {CANARY_PROMPT}
  {ROSTER_PROMPT}

Note each answer with the agent's version; references/runtimes.md has the results measured so far.
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "directory", type=Path, help="a new or empty directory to build the fixture in"
    )
    parser.add_argument(
        "--claude-md",
        choices=("import", "symlink", "none"),
        default="import",
        help="the CLAUDE.md adapter beside each AGENTS.md (default: import)",
    )
    parser.add_argument(
        "--oversize", action="store_true", help="pad AGENTS.md past 32 KiB"
    )
    args = parser.parse_args()
    root = args.directory.resolve()
    if root.exists() and any(root.iterdir()):
        print(f"probe_fixture: {root} is not empty", file=sys.stderr)
        return 2
    try:
        build(root, args.claude_md, args.oversize)
    except (OSError, subprocess.CalledProcessError) as exc:
        print(f"probe_fixture: cannot build the fixture: {exc}", file=sys.stderr)
        return 2
    print(probes(root, args.claude_md))
    return 0


if __name__ == "__main__":
    sys.exit(main())
