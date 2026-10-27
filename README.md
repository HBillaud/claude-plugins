# Hadrien Labs

Skills and mods for Claude Code, published as one marketplace: `hadrien-labs`.

## Install

At the prompt of a Claude Code terminal session, add the marketplace once:

```
/plugin marketplace add HBillaud/claude-plugins
```

Then install what you want from it:

```
/plugin install session-band@hadrien-labs
/plugin install worktrees@hadrien-labs
/plugin install web-agency@hadrien-labs
/plugin install agent-config@hadrien-labs
/plugin install design-studio@hadrien-labs
```

From a shell, the same works as `claude plugin install session-band --marketplace HBillaud/claude-plugins`.

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `HBillaud/claude-plugins`, then **Add plugin**.

To pick up new versions: `/plugin marketplace update hadrien-labs`.

## What's inside

| Plugin | Kind | What it does |
| --- | --- | --- |
| [session-band](plugins/session-band) | mod | One band above the prompt: what the session works on, where, how much of the session limit is used, and a replay of the last turn's edits. Adds `/worktree` and `/replay`. The task label can use Claude Haiku, local parsing with no model call, or be turned off. |
| [worktrees](plugins/worktrees) | skills | `/worktrees:plant-tree` gives a task its own git worktree under `.claude/worktrees/`; `/worktrees:prune-trees` safely deletes the ones you no longer need. |
| [web-agency](plugins/web-agency) | skills | `/web-agency:audit-dns` audits live DNS records, registrar/host dashboard screenshots, and project codebases for routing issues, split-DNS traps, email deliverability (`MX`, `SPF`, `DKIM`, `DMARC`), and transactional mailers. |
| [agent-config](plugins/agent-config) | skills | `/agent-config:canonical-agent-config` audits or migrates a repository's agent config (CLAUDE.md, AGENTS.md, skills, subagents, rules) to one canonical source with thin per-agent adapters, an inventory, agent probes and a CI guard. |
| [design-studio](plugins/design-studio) | skills | `/design-studio:redesign-section` takes a section from mockups (desktop and 375px artboards, motion notes) through a contract to a verified build on its own branch; `/design-studio:check-responsive` probes a page at every breakpoint with reduced motion on and off; `/design-studio:audit-type-scale` measures type roles across routes and aligns them to a reference page; `/design-studio:prep-hero-media` transcodes and wires hero video and images poster-first. |

## Developing

Each plugin lives in `plugins/<name>/` and is listed in `.claude-plugin/marketplace.json`.

Run a plugin from this folder without installing it:

```
claude --plugin-dir plugins/session-band
```

Before a release, bump `version` in the plugin's `.claude-plugin/plugin.json`, then check:

```
claude plugin validate .
claude plugin validate plugins/<name>
claude plugin test plugins/<name>
```

Mods are built against the Claude Code engine API; session-band was last tested on Claude Code 2.1.303.
