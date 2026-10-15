# code-agent

A minimal coding agent built from scratch in TypeScript, replicating the core architecture of [opencode](https://opencode.ai): a double-loop agent runtime, five tools, SQLite persistence, subagents, context compaction, and shadow-git snapshots.

**Design docs (Chinese):** [`docs/superpowers/specs`](docs/superpowers/specs/) · 25-task TDD plan in [`docs/superpowers/plans`](docs/superpowers/plans/)

## Architecture

```
cli/            REPL: readline input → streaming render → y/n/a permission prompts
session/        runLoop (outer while-loop, rebuilds context from DB every turn)
                processor (single LLM step via streamText)
llm/            AI SDK v6 wrapper with event normalization + retries
tool/           read / grep / glob / edit / bash / task
permission/     wildcard rules, last-match-wins, interactive ask
compaction/     prune old tool outputs + anchored-summary compaction
snapshot/       shadow git repo: track / patch / revertTo
storage/        SQLite: session / message / part (DB is the single source of truth)
agent/          agents as data: main + read-only explore subagent
```

Key decisions:

- **Double loop** — the outer `while` loop rebuilds the full message context from SQLite every turn; the inner `streamText` runs exactly one step. No in-memory session state: crash-safe by construction.
- **DB is the only source of truth** — messages and parts are upserted as they stream in.
- **Tolerant edit matching** — 4-level replacer chain (exact → line-trimmed → indentation-flexible → block-anchor with fuzzy middle), gated by uniqueness and disproportion checks.
- **Compaction** — keeps the last turns within a budget (25% of context, clamped 2k–8k tokens), summarizes the head into an anchored `[Summary]`, and rebuilds context from the compaction anchor onwards. Old tool outputs are pruned behind a 40k-token protection window (20k minimum cleanup).
- **Shadow git snapshots** — a hidden git repo keyed by worktree hash records every turn; `/revert` restores the pre-turn state.
- **Doom loop detection** — a third identical tool call triggers a permission prompt that can break the loop.

## Milestones

| M | Scope | Status |
|---|-------|--------|
| M1 | REPL + read/grep/glob + run loop | ✅ |
| M2 | edit + bash + permission system | ✅ |
| M3 | prune + compaction + context rebuild | ✅ |
| M4 | task tool + explore subagent | ✅ |
| M5 | snapshots + `/revert` | ✅ |
| M6 | doom loop detection + crash recovery + E2E | ✅ |

## Usage

```bash
npm install
npm link            # registers the global `code-agent` command
npm test            # 85 tests, zero network
```

Run it inside any project (that project becomes the agent's workspace — its cwd, snapshot worktree, and permission scope):

```bash
cd /path/to/your-project
code-agent                        # picks a provider by available env key
code-agent --model moonshot/k3    # or pin a model explicitly
```

Providers: `anthropic` (env `ANTHROPIC_API_KEY`) and `moonshot`/Kimi (env `MOONSHOT_API_KEY`; `sk-kimi-` keys auto-route to the Kimi Code endpoint, classic keys to api.moonshot.cn). Development without linking: `npm run dev` (workspace = this repo).

Tools are read/grep/glob by default; edit/bash prompt for confirmation (y/n/a — "a" remembers for the session). Slash commands: `/exit`, `/revert`, `/compact`.

## Testing

85 tests across 22 files, all offline: the LLM is a scripted `MockLanguageModelV3` (see `test/helpers/model.ts` for this AI-SDK version's provider-chunk dialect), the E2E golden test drives real read → edit tools against a fixture repo and asserts both DB state and file contents.
