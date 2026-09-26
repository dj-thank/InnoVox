# Running the first preview

This is a **single-user preview**, not a multi-tenant public service. It implements
durable conversation observations, project conditions, source-bound questions,
answers, and a delivery queue. GPT Live and Astra adapters exist but need live
account and human validation. Automatic input into desktop agent sessions and
native screen capture are not implemented.

## Local setup

Use Node.js 24.19 or a newer 24.x release and pnpm 11.19.0:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm init-local
pnpm diagnose
pnpm start
```

Open `http://127.0.0.1:4317`. The browser asks for the InnoVox access token stored
in `.innovox/access-token`. This application token is separate from the OpenAI
API key. `setup` does not print or replace an existing token. On POSIX systems it
creates the directory/file with restrictive modes; on Windows verify the account's
filesystem ACL before using sensitive data on a shared machine.

The explicit synthetic sample works without a provider key. No silent mock
fallback exists. A provider failure stays visible.

Provider credentials belong in a secure server environment or an ignored
`.env.local` after secure provisioning. They are never entered into the web UI.
Restart the server after changing environment configuration. `doctor` reports
presence, not key validity or account access. The initial models are fixed to
`gpt-6-astra` and `gpt-live-1`; no model fallback is performed.

For Mac, read [the feature and permission guide](platforms/macos.md).

## Behavior and limits

- A project must explicitly opt into automatic analysis. Manual analysis is an
  explicit provider action. Relevant conditions and at most 40 recent message
  events (up to 3,000 characters per event) are supplied as reference data.
- Analysis is serialized and automatic collection is batched. Local hourly
  admission limits persist across restarts. These are not monetary billing caps.
- The browser limits one voice interaction to five minutes in a normally running
  tab. This is a UI limit, not a server-enforced billing limit; do not expose it
  as an unlimited public service. Provider access controls and cost enforcement
  are prerequisites for hosted rollout.
- Voice transcript deltas are drafts. The user can correct them before saving.
  Closing or switching a window must not silently approve a draft.
- Answers are queued for their original session. Copying an answer does not mark
  it delivered. An adapter must claim a delivery and supply a receipt; a crash
  while claimed changes the outcome to unknown and disables automatic retries.
- Questions expire after 15 minutes. Updated project conditions or a newer
  explicit session epoch supersede pending questions and cancel queued answers.
- The current UI does not promote answers into permanent project conditions.
  Edit the conditions explicitly when the intended project policy changes.

## Capture a selected conversation

The collector reads only one explicitly selected JSONL file. It sends supported
user/assistant text blocks to the selected InnoVox project. This can include
private conversation content: select the intended source and destination.

```sh
pnpm capture --file /path/to/selected-session.jsonl --project PROJECT_ID --session SOURCE_SESSION_ID --adapter codex --follow
```

Use `--adapter claude` for the supported Claude Code message-log shape.
Use `--url https://your-server.example` for a cloud endpoint. Supply the same
InnoVox access token through `INNOVOX_ACCESS_TOKEN`, not command-line arguments.
The collector never reads provider credentials, automates a session, or launches
a second coding agent.

Profiles: `codex-message-log-v1` handles `response_item` messages;
`claude-message-log-v1` handles `user`/`assistant` message records. These are
InnoVox parser-profile names, not vendor guarantees. Recognized source session
metadata must match the selected session ID. Hidden reasoning and tool blocks
are skipped. Unrecognized records are counted as skipped, not treated as proof
of complete extraction. Missing timestamps use an explicit Unix-epoch sentinel.

The collector waits for a newline before parsing a trailing record, processes
bounded chunks, and pauses on errors. Restarting replays from the beginning and
uses deterministic event identities to deduplicate. This prioritizes recovery
correctness over fast startup for very large files. Rotation/truncation is an
explicit stop; choose the new source and an increased `--epoch` to start a new
generation. In-place rewrites without truncation need further validation.

## API contract

All `/api/*` routes require `Authorization: Bearer <INNOVOX_ACCESS_TOKEN>`.
Browser requests must use the configured origin. Payloads are JSON, bounded to
300 KB, validated by the versioned contracts in `src/contracts.ts`.

- `GET /api/state?projectId=...`: current projections, recent messages and capabilities.
- `GET /api/journal?after=N`: bounded audit pages with a monotonic cursor.
- `POST /api/projects`, `PUT /api/projects/:id`: conditions and explicit revision checking.
- `POST /api/events`: version-1 event ingestion; duplicate id/content is idempotent.
- `POST /api/analyze`: analyze one explicitly selected source session.
- `GET /api/consultations/:id`: authoritative current question state.
- `POST /api/consultations/:id/answer`: question version + stable answer id + text/channel.
- `POST /api/consultations/:id/cancel`: cancel a pending question.
- `POST /api/deliveries/:id/claim`, `POST /api/deliveries/:id/receipt`: delivery lifecycle.
- `POST /api/live/session`: pending question/version and browser SDP offer.
- `POST /api/demo`: explicit synthetic sample.

Unknown domain event kinds are preserved. Unsupported schema versions are
rejected. Delivery APIs are for trusted adapters under the single-user token;
they are not evidence that a particular third-party application adapter exists.

## Cloud deployment preparation

The Dockerfile builds and tests the same server. It runs as a non-root user.
Deploy one instance with a persistent local volume for `.innovox`, an explicit
random access token, a secret-managed provider key, and a TLS reverse proxy.
Set `INNOVOX_HOST=0.0.0.0` and `INNOVOX_ORIGIN=https://your-domain.example`.
Only `/healthz` is public health metadata; it does not check provider readiness.

Do not scale replicas against one SQLite file or store WAL files on network
filesystems. Back up with a SQLite-aware backup procedure or stop the service
before copying all state. Raw state contains conversation/answer text.

Public multi-user hosting still requires individual identity, tenant isolation,
per-user quotas, server-enforced voice/session termination, retention and deletion,
provider-access verification, and an approved deployment/budget. No paid cloud
resources or public service are provisioned by this repository.

## Verification

`pnpm check` runs strict TypeScript and Node tests for contracts, state, recovery,
collector parsers, HTTP boundaries, and mocked provider response shapes.
The CI matrix runs on Linux, Windows, and macOS; a container job builds the
Dockerfile. Mocked provider checks do not establish live provider access or
human acceptance. Actual browser/device evidence is tracked separately.
