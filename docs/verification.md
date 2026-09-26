# Verification record

Date: 2026-09-26. Scope: the first single-user conversation/consultation preview.

## Mac operation preparation (0.4)

- `pnpm check` passed all 55 local tests with the optional native Codex binary.
  Without that selected binary, 54 tests run and one native test is skipped.
- HTTP tests exchange a one-time code for a separate browser credential, reject
  code reuse and cross-origin exchange, prevent a paired browser from issuing
  codes, and verify revocation on logout. Unit checks cover code/session expiry
  and the five-attempt limit.
- Online SQLite backup/restore tests include committed WAL data and an answered
  consultation with a claimed delivery. The live writer remains unchanged; the
  restored service treats the in-flight delivery as unknown. Changed bytes and
  attempts to replace existing files are rejected.
- Mac LaunchAgent generation binds the exact checkout and Node path and escapes
  XML correctly without embedding credentials. The Mac CI test also runs Apple's
  `plutil` against that generated plist; this is separate from actual login/startup
  and crash-recovery acceptance on a user's Mac.
- The Mac report script checks metadata/tool presence only. Shell syntax is checked
  in Mac CI. Merely supplying the script is not evidence that a Mac was inspected.

The development host's authenticated preview was exposed over a private HTTPS
connection for device testing. Automated browser access was blocked by the client,
so no browser, microphone or native Mac acceptance is inferred from server health.
A separate attempt to attach a control socket to a primary WebSocket session
returned HTTP 404 and was closed through the primary connection. The documented
sideband path targets [WebRTC/SIP sessions](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live);
that result does not establish a WebRTC control failure or successful server-side
termination. Server-enforced voice lifetime remains an open production requirement.

## Authenticated provider check (0.3)

On 2026-09-26 at 04:46 UTC, `pnpm provider-check --live` passed against real
OpenAI endpoints from Windows, using implementation commit
`d40e2a07082f68e46cf2fb1a6c0730e77d24b1b9`, Node.js 24.19.0 and OpenAI SDK 7.23.0.

- The project credential was persisted in an ignored server-side configuration
  with access restricted to the local user and SYSTEM. No credential or private
  conversation was included in public source, reports or provider test input.
- `gpt-6-astra` returned a structured intervention for the synthetic project.
  The service adapter parsed it and the store validated its evidence references.
- `gpt-live-1` accepted the primary WebSocket session and returned 123,840 bytes
  of PCM output with nonzero samples. The final `session.closed` event arrived,
  with reported usage of 2 seconds and no probe error. A local WAV was retained.
- The diagnostic used synthetic conversation data and paced silence, with no
  microphone recording, model fallback or automatic reconnection.

This establishes bounded authenticated reasoning and audio-output access with
the tested credential. Browser WebRTC, speech recognition, spoken corrections,
human listening and delivery to an actual working agent remain unverified.
It does not establish access for every account or complete the original product
acceptance scenario. See [provider checks](provider-check.md) to reproduce it.

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
  exits without a request. Authenticated Astra and GPT Live output were later
  verified as recorded above; browser WebRTC acceptance remains open.

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
- Bounded authenticated provider checks passed as recorded above. Browser voice,
  real speech latency, interruption, and human hearing checks remain open.
- No native macOS screen/accessibility component is shipped. The Codex write
  bridge's native proof is limited to the isolated Windows runtime described
  above. Mac OS permissions, native transport and audio are not device-verified.
- No public hosted service or paid cloud resource was deployed.

For the current implementation boundary, see [operations](operations.md),
[roadmap](roadmap.md), and [Mac acceptance](platforms/macos.md).
