# Session discovery and the Codex delivery bridge

These are local companion commands. They connect an explicitly selected source
scope to a local or hosted InnoVox service. They do not grant access to arbitrary
desktop apps, discover credentials, or change an agent's execution permissions.

## Discover and collect conversations

```sh
pnpm discover --root /path/to/codex/sessions --root /path/to/claude/projects --workspace /path/to/project
```

Without `--collect`, this only reports matching session metadata. Metadata must
identify the source session and a working directory inside the selected workspace.
Folder names alone are not used to infer project ownership. Symlink directories
are not followed. Duplicate files claiming the same source/session are reported
as ambiguous and excluded.

```sh
pnpm discover --root /path/to/codex/sessions --root /path/to/claude/projects --workspace /path/to/project --project PROJECT_ID --collect --watch
```

Configure `INNOVOX_ACCESS_TOKEN` for the chosen service, or use the local generated
token for a loopback destination. Set `--url https://your-innovox.example` for a
cloud service. Provider keys never belong in collector arguments.

The default discovery bound is 1,000 JSONL files and eight directory levels, with
a directory-visit cap. `--limit` can change the file bound up to 10,000. Each
metadata probe reads at most 256 KiB and checks at most 20 lines. Unchanged file
metadata is cached during watch mode. Reported metadata counts are separate from
the number of conversation messages actually imported.

Collection processes bounded chunks and closes file handles between passes.
Partial trailing records wait for completion. Source rotation, truncation,
ambiguous identity or uncertain upload pauses the source instead of relabeling
old bytes. Restarting replays with deterministic event IDs. Select an increased
`--epoch` only when explicitly beginning a new source generation.

For the first historical import, leave automatic analysis disabled until the
intended source set is loaded. Watch mode checks for new matching sessions and
appended records; it is not a claim to capture every internal vendor event.

## Deliver a confirmed answer to Codex

The bridge uses the documented App Server interface. It connects through
`codex app-server proxy` to an existing local daemon and verifies a loaded thread,
its working directory, and the explicit InnoVox project/session/epoch binding.
It never creates/resumes a thread or starts a model turn as a hidden fallback.
[Codex App Server](https://learn.chatgpt.com/docs/app-server)

```sh
pnpm relay-codex --project PROJECT_ID --session CODEX_THREAD_ID --workspace /path/to/project --codex-bin /path/to/codex --watch
```

On Windows, `--codex-bin` must name the actual `codex.exe`, not a `.cmd` wrapper.
The source must have been captured with adapter `codex` and the same session ID.
`--epoch` defaults to zero; it must match the queued answer's source generation.

Two modes are explicit:

- `active-turn` (default): verifies the current in-progress turn, then uses
  `turn/steer` with that exact `expectedTurnId`. An idle/unloaded target stays queued.
- `next-turn-context`: requires a loaded idle thread and appends a user-message
  item through `thread/inject_items`. It does not wake the model. The context is
  available for a subsequent model request.

The App Server interface is experimental. An ordinary desktop installation is
not guaranteed to expose the daemon used by `proxy`. Do not start a second agent
against an active checkout to work around a missing connection. Configure the
intended owning App Server explicitly, or leave delivery pending.

## Acceptance, persistence, and actual use are different

The outbox is claimed only after preflight. A verified RPC response records
`accepted`, not a claim that the model acted on the answer. A missing response
records `unknown` and disables automatic resend. An abandoned claim expires to
`unknown` after one minute, even if the service does not restart.

To verify local persistence, pass `--receipt-file /path/to/the-selected-rollout.jsonl`.
The reader checks the source-session header and the delivery's unique marker and
content digest. A matching readback advances the outbox to `delivered`. This
still does not prove that the model used the information or that a task succeeded.

Normal collection can also observe the source echo. Only an exact match to a
known in-flight/accepted delivery in the same project/session/epoch is classified
as InnoVox-originated and excluded from new reasoning. Merely writing an origin
label or a marker-shaped string cannot suppress a human message. A later timeout
cannot overwrite stronger persistence evidence.

## Native verification

The optional test uses an isolated Codex home and synthetic messages:

```sh
INNOVOX_NATIVE_CODEX_BIN=/path/to/codex pnpm test
```

On Windows, set that environment variable in PowerShell before running the test.
The test starts its own App Server, captures its real persisted history, sends a
confirmed synthetic answer through the InnoVox HTTP API and relay, verifies one
persisted copy, and checks that the echo does not change the reasoning context.
No model turn is requested. Its ignored synthetic trace is retained under
`.innovox/native-codex-test-*` for inspection; it is never committed.

This passed locally with Codex CLI `0.155.0-alpha.16.4` on Windows. CI skips the
native test when no exact binary was selected; the protocol/logic tests still run.
The installed desktop app, active model steering, a user's actual session and
Claude delivery still need their own acceptance evidence.
