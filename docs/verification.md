# Verification record

Date: 2026-09-26. Scope: the first single-user conversation/consultation preview.

## Scoped discovery and Codex delivery (0.3)

- Windows x64, Node.js 24.19.0, pnpm 11.19.0: `pnpm check` passed all 50 tests
  with an explicitly selected native Codex binary. Without that optional binary,
  49 tests run and the native test is skipped.
- Scoped discovery checks cover Codex/Claude metadata, workspace filtering,
  duplicate identities, explicit bounds, metadata cache invalidation, incremental
  UTF-8 records and uncertain-upload pauses. They use synthetic fixtures.
- Protocol tests pin thread/workspace/epoch and active-turn identity. They
  distinguish `accepted` from persisted delivery, expose lost acknowledgments,
  bound RPC frames and never answer the source agent's permission requests.
- The native test used Codex CLI `0.155.0-alpha.16.4` with an isolated home and
  synthetic messages. It ran capture → actual InnoVox HTTP/store → delivery
  bridge → native `thread/inject_items` → persisted source readback. One copy was
  observed, a second claim was rejected, and the source echo did not change the
  reasoning fingerprint. No model turn or user's session was used.
- The real runtime rejected an omitted `params` member even for an empty-argument
  RPC. The client now sends `{}` and the native check passes. This is evidence
  for the selected runtime, not a guarantee across all App Server versions.
- Orphaned delivery claims become `unknown` after one minute without a restart.
  Exact known source echoes can establish persistence; untrusted origin labels
  cannot suppress human content, and a late timeout cannot downgrade persistence.
- Receipt readback checks the complete answer digest, not just its marker. An
  upgrade test preserves existing answers, retains protocol acceptance over a
  restart and rejects databases from an unsupported newer version.
- The explicit `provider-check` command is implemented. Its missing-key path
  exits without a request. Authenticated Astra, GPT Live output and browser
  WebRTC results remain unverified.

Native transport/persistence is a bounded device result. Actual active model
steering, ordinary Codex Desktop attachment, Claude delivery and human voice
acceptance remain open. See [connectors](connectors.md) for reproducible commands.

## Requirements-driven corrections (0.2)

The original acceptance audit of `cb591cdc9e1b3a259842a8f343ad16c6dce4559e`
found concrete missing behavior despite the earlier 22 passing tests. The 0.2
correction set passed 34 local tests, including these cases:

- A newer human correction blocks the old question's answer, invokes fresh
  reasoning, and can supersede the obsolete question.
- Complete selected records reach the reasoning context; a significant suffix
  after character 3,000 is retained. Budget omissions are explicit. This is not
  a claim to include every historical message or every fragment of a huge source
  message.
- Connected peer-session context is available within one project, and qualified
  evidence IDs prevent vendor event-ID collisions. Other projects stay excluded.
- Non-message progress events cannot evict the relevant message window.
- The answer envelope contains the question, rationale and evidence; a changed
  conversation blocks dispatch until reconciliation.
- The simulated voice controller calls the HTTP backend, which calls the Astra
  adapter. A read-back acknowledgment, subsequent explicit confirmation and
  idempotent commit save one answer without a save-button click.
- A corrected/new utterance invalidates old confirmation resolutions, including
  while the newer interpretation is still in flight.
- Long Japanese question framing preserves the ending instead of slicing the
  question at character 500. Actual spoken fidelity is still unverified.
- Provider response buffering is capped during streaming.

All new voice/media/model inputs in these checks are synthetic. They establish
local control flow, not authenticated model quality, audible playback, identity,
real source-agent receipt or the full [original acceptance scenario](requirements.md).
The audit/correction review used separate local standards and specification
passes; no independent-agent review is claimed.

## Earlier 0.1 local evidence

- Windows x64, Node.js 24.19.0, pnpm 11.19.0.
- `pnpm check`: strict TypeScript and 22 passing tests.
- The integration suite launches the actual collector as a separate process and
  sends synthetic JSONL messages to the HTTP server, including incomplete tails
  and repeated imports.
- SQLite restart tests verify stored answers and unknown in-flight delivery
  outcomes. HTTP checks cover authentication, origin checks, static assets,
  explicit demo creation, answer persistence, and missing-provider errors.
- Provider tests inject synthetic HTTP responses. They verify request/response
  contracts only; no live GPT Live or Astra call was made.
- `pnpm contracts` exports five JSON Schemas; `pnpm init-local` and `pnpm diagnose`
  were executed. The local application token is ignored by Git and is not an
  OpenAI credential.
- `pnpm audit --prod`: zero reported advisories for one production dependency.
  This is a dependency advisory check, not a product security assessment.
- Local review used separate standards/spec passes. Independent-agent attempts
  did not return an accepted review and were excluded.

## Historical CI and remaining evidence

- [GitHub Actions run 36210191171](https://github.com/dj-thank/InnoVox/actions/runs/36210191171)
  passed the 0.2 main commit `fe9e36f8f628cae496e649b16f41e045ac1f8ba8` on
  Windows, Linux, Apple Silicon macOS and the container build; its runtime suite
  contained 34 tests.

- [GitHub Actions run 36207584233](https://github.com/dj-thank/InnoVox/actions/runs/36207584233)
  passed all four jobs on implementation commit `28a0e3c46153e1554e63382eacc7fe391578b19c`:
  Windows, Linux, macOS, and Docker build. The pull-request run also passed.
- The Mac job used `macos-26-arm64`, reported `darwin`/`arm64`, and passed all 22
  tests on Node.js 24.19.0. This confirms the tested Apple Silicon runtime path;
  it does not establish Intel Mac compatibility or microphone/screen behavior.
- Check the exact commit's run when making future compatibility claims.
- The local Docker daemon was unavailable, so no local image-build result is claimed.
- Connected-browser access to the preview was blocked by the client. Visual UI
  acceptance remains open; HTTP asset checks are not a substitute.
- OpenAI credential provisioning, live model/account access, voice latency,
  interruption, and human hearing checks remain open.
- No native macOS screen/accessibility component is shipped. The Codex write
  bridge's native proof is limited to the isolated Windows runtime described
  above. Mac OS permissions, native transport and audio are not device-verified.
- No public hosted service or paid cloud resource was deployed.

For the current implementation boundary, see [operations](operations.md),
[roadmap](roadmap.md), and [Mac acceptance](platforms/macos.md).
