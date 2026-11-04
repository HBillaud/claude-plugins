# Moving generic skills into a shared plugin

The canonical layout removes copies inside one repository. A team with several repositories has the same problem one level up: each carries its own `code-review`, `python-style` or `write-design-doc` skill, copied once and drifting since. The cure is the same: one owner. Generic craft moves into a plugin every repository enables, and each repository keeps only what is true of itself.

Do this only when the user maintains several repositories that carry copies of the same generic skills. For one repository, the canonical layout is the whole job.

## What moves and what stays

| Moves to the plugin | Stays in the repository |
| --- | --- |
| Guidance true of any codebase: a language's idioms, a review procedure, how to write a design document, how to work an issue | Anything that names this repository's paths, types, commands, components, services or decisions |
| Generic subagents: a CI investigator, a history researcher, a test runner | The repository's own rules: in AGENTS.md, in `paths:`-scoped rule files, or in thin repository skills |
| The working rules every repository shares, the shared deny list | Where the repository deliberately differs from the plugin, and why |

A generic skill usually carries a few repository facts that grew into it: a header path, a command, a count. Those are what make the extraction work rather than a deletion.

## Step 1: enable the plugins (one pull request)

1. **Enable the marketplace and the plugins** in the project's `.claude/settings.json`, so every developer's session gets them:

   ```json
   {
     "extraKnownMarketplaces": {
       "<marketplace>": { "source": { "source": "github", "repo": "<owner>/<marketplace-repo>" } }
     },
     "enabledPlugins": {
       "<plugin>@<marketplace>": true
     }
   }
   ```

2. **Carry in the settings what a plugin cannot impose on a project:** the shared deny list (and name each denied command in AGENTS.md, which the guard's `settings-deny` checks), any environment, and a `SessionStart` hook that names each plugin the repository enables and the machine has not installed, because a session without them lacks those rules silently. `scripts/check_plugins_installed.py` is that hook: copy it to `scripts/agents/` and wire it as its docstring shows.
3. **Write the differences down.** `.claude/rules/claude-code.md` says what the plugins bring, how a machine installs them, and each place where the repository deliberately departs from them, with the reason ("JSON keys keep each wire surface's casing; the plugin's naming rule does not apply"). Where the two disagree, the repository wins, and saying so prevents a session from "fixing" a deliberate choice.
4. Leave the local copies in place for now; on a machine with the plugins both load, briefly.

## Step 2: remove what the plugin replaces (one pull request)

For each local skill or subagent the plugin covers:

1. **Compare first.** The inventory's "On this machine" table lists each local skill that an installed plugin also provides, with the share of lines they have in common. Read both: the plugin's version should be at least as good on everything generic.
2. **Move the repository's facts out of it**, each checked against today's tree, because copies carry stale paths and counts: into a `.claude/rules/<topic>.md` with `paths:` for Claude Code (C++ rules for `src/**`, CI rules for `.github/**`), into a thin repository skill when every agent needs it, or into AGENTS.md when every session does.
3. **Delete it,** then `git grep` every removed name: documentation, hook messages, CI comments and other skills' cross-references must name the plugin's skill instead. Zero hits is the exit gate.
4. **Update the guard:** a subagent may now preload `plugin:skill` names, which the guard reports as unchecked rather than unresolved.

## After: upstream, never fork

- A repository skill that turns out to be generic moves to the plugin first; the repository deletes its copy once the plugin release that carries it is out.
- A fix to generic guidance lands in the plugin, never as a local patch.

## Caveats

- **Plugins are Claude Code's mechanism.** Codex, Cursor and the rest do not load them, so moving generic skills into a plugin takes them away from those agents in that repository. Either accept it consciously (AGENTS.md still carries the repository's own rules for every agent; the generic craft becomes Claude Code's), or also publish the generic skills somewhere those agents read (a user-level `~/.agents/skills` they sync, or the agent's own plugin system, once verified).
- **Versions drift per machine.** With `autoUpdate` and no pinned version, a machine gets new skills when its plugin cache updates; one on an older version lacks them until then. Say so in the pull request that relies on a new plugin release.
- **Automated reviewers may not see a private marketplace.** A CI review job without a token for it reviews without the plugins' rules.
