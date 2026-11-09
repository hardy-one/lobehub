# Prompt Capture Harness

This harness is the isolated verification path for the on-demand context mode.
It captures the complete upstream chat-completions request at a local mock
provider and records the matching operation trace. It does not use the Debug
Proxy, `app.lobehub.com`, a fixed development port, the shared database, or a
shared Redis namespace.

## Prerequisites

- The repository `.env` points at local Postgres and Redis.
- The local test user and API key exist (`.records/env/agent-testing-cli.env`).
- The Postgres test container is running. Override its name with
  `PROMPT_HARNESS_PG_CONTAINER` when needed.
- No other prompt-harness stack is running. The lock permits exactly one.

## Run

```bash
bash scripts/promptHarness/stack.sh --keep
```

Run one focused scenario:

```bash
bash scripts/promptHarness/stack.sh --scenario baseline-legacy --keep
```

The command prints a JSON line containing `runRoot`, `captureDir`, `nextPort`
and `mockPort`, followed by one line per verification check. The final report is
`<runRoot>/result.json`.

By default all fixtures run in this order: the three baselines, memory and
expertise, skill discovery and activation, document discovery, tool activation,
and long-document loading. The two baseline scenarios use the same exact Agent
Prompt and user message on different Agents. Memory, skill, document, tool
activation, and long-document checks exercise their real runtime paths. The
provider is repointed only in the cloned database and uses the non-secret key
`prompt-harness-not-a-secret`.

## Isolation and teardown

- `stack.sh` takes a non-blocking `flock`; a second run exits with status 2.
- Next and the mock bind random ephemeral `127.0.0.1` ports. Ports 3010, 3311,
  8080, 3901 and 3902 are rejected as stack ports.
- The source database is cloned with `pg_dump | pg_restore`; fixtures are
  seeded into the clone. The source database is never mutated.
- Redis uses `prompt-harness:<run-id>:` as its prefix.
- Next starts with a test-only Date preload pinned to
  `PROMPT_HARNESS_FROZEN_TIME` (default `2026-11-02T12:00:00.000Z`), so dated
  environment text cannot make the request hash drift between days. `Date.now()`
  remains live, so operation/timer ids stay unique.
- Both processes run in their own process groups and are terminated with
  `SIGTERM`, then `SIGKILL` after five seconds.
- The clone is terminated and dropped, the disposable Next build directory is
  removed, and both ports are checked closed.

Capture files live under the OS temporary directory, never under the repository.
Header names such as `authorization`, `cookie` and `x-api-key` are replaced with
`[REDACTED]` before writing. Request bodies remain byte-complete for system
messages, messages and tool schemas.

## Artifacts

```
<runRoot>/
  captures/001-*.json ...   complete upstream request envelopes
  traces/<scenario>.json    matching `lh trace op inspect` output
  runs/<scenario>.json      local CLI SSE JSON
  logs/                     next, mock and CLI stderr
  manifest.json             scenario-to-capture mapping and teardown state
  result.json               checks, hashes and run metadata
```

Each capture envelope contains:

- the full `request` object;
- the ordered tool names;
- canonical hashes for the full request, messages, tools and messages+tools;
- sanitized headers, method, URL, timestamp and sequence.

## Canonical baseline

`fixtures/legacyBaseline.json` and `fixtures/legacyChatBaseline.json` are hash-only
regression fixtures. Their canonicalization is `prompt-harness-baseline-json-v3`:
recursively sorted object keys, array order preserved, compact JSON and SHA-256 —
the same canonicalizer as the request captures, but computed over an
**environment-normalized** request. Two context blocks derived from runtime
environment state are excluded from the stable baseline hash by replacing their
bodies with a fixed placeholder before hashing:

- `<available_tools>` — the installed-but-disabled plugin catalogue, which drifts
  with plugin install state;
- `<agent_management_context>` — the recent-agent roster, which drifts with seed data.

The normalized request still hashes object/array order, so any byte the PR itself
controls still moves the hash; only the drifting block bodies are neutralized. The
two excluded blocks are recorded verbatim (sorted, de-duplicated) in the fixture
`provenance.environment` snapshot (`availableTools`, `availableAgents`), so drift
stays observable without making the hash unstable.

When the file is present, every run fails if any of the four stable request hashes
(`full`, `messages`, `messagesAndTools`, `tools`) changes. Fixtures that still
declare `prompt-harness-canonical-json-v2` are compared against the raw
(non-normalized) hashes for backward compatibility; refresh them to v3 as below.

### Refreshing the baseline fixture

Fixtures may be refreshed per branch when the legacy request shape legitimately
changes. Refresh on a machine that can run the full stack:

```bash
bash scripts/promptHarness/stack.sh --update-baseline --scenario baseline-legacy,baseline-chat --keep
```

This rewrites both baseline fixtures with the stable v3 hash and records
`provenance.sourceCommit`, `capturedAt`, `note` and the `environment` snapshot (the
`<available_tools>` catalogue and `<agent_management_context>` roster). Only refresh
when the change is intended, and record the reason in the `note` and the PR. Never
hand-edit the hashes.

Before refreshing, confirm `.env` points at the harness's isolated stack: `APP_URL`
must not use `:3010` (use the isolated port, e.g. `3311`), the Postgres port must
match the test container (commonly `5433`), Redis the test port (commonly `6380`),
and the CLI key must exist in the seeded database (e.g. `ak_harness0001`).

The authoritative Task 0 artifact was not present in the repository or tracked
history. This fixture therefore records its provenance explicitly instead of
claiming that a later capture is Task 0.

