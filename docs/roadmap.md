# Delivery roadmap

Every milestone needs a runnable demonstration and explicit acceptance evidence.
The order below expresses product intent, not a claim that these features exist.
The [original acceptance scenario](requirements.md#critical-acceptance-scenario)
remains open; API credentials alone will not complete it.

## M0 — Public project foundation

- [x] Public GitHub repository exists.
- [x] Product direction and development instructions published.
- [x] MIT License selected and published.
- [x] GPT Live public API and a new InnoVox-specific key selected.
- [x] Protected dedicated credential and bounded authenticated provider access verified.
- [x] First implementation stack and its reasons recorded in ADR 0001.

## M1 — A reliable conversation-to-consultation slice

Input: synthetic conversation events and explicit project conditions.
Output: a source-bound consultation and a correctly routed, durable answer.

- [x] Versioned event storage and a cursor-based audit journal.
- [x] Explicit project conditions with reason and revision.
- [x] Consultation lifecycle, editable replies, expiration, and reply binding.
- [x] Idempotent ingestion and delivery intent; visible unknown outcomes.
- [x] Contract tests for duplicates, out-of-order input, stale replies, and restart.
- [x] A browser inspection surface exposing the actual state.
- [ ] Visual/device acceptance of the browser experience.
- [x] Verified SQLite backup and restore rehearsal without replacing the live database.
- [ ] Portable project export, replay tooling, and retention controls.

Synthetic fixtures establish local behavior only. They do not prove Astra
reasoning, GPT Live voice, or a supported application's integration.

## M2 — GPT Live + Astra, real end-to-end

The WebRTC and Astra HTTP adapters are implemented and contract-tested with
synthetic responses. A real Astra structured proposal and GPT Live WebSocket
audio output now pass the bounded diagnostic. Browser and human acceptance remain open.
Contextual voice follow-ups, answer read-back, explicit spoken confirmation and
idempotent persistence now have a synthetic controller-to-HTTP test. This is not
real microphone, model, agent-delivery or human acceptance.

- Supported, authenticated GPT Live browser WebRTC connection.
- Astra receives only the relevant conversation/project context.
- A useful proactive question occurs without an AskUser event.
- A spoken answer reaches the intended task and its receipt is observable.
- Natural consecutive turns, interruption, and correction are checked by a person.
- Provider failure and reconnection preserve task state without duplicate effects.

## M3 — One real session connector

Selected-file collection, explicitly scoped multi-session discovery/backfill/watch,
and an optional Codex App Server delivery bridge are implemented. A native test
with an isolated Codex CLI `0.155.0-alpha.16.4` on Windows verifies capture through
persisted answer delivery with synthetic messages and no model turn. Protocol
acceptance, source persistence and actual model use remain separate. This does
not close desktop attachment or the real working-agent acceptance items below.

- Observe an existing supported Codex or Claude Code session.
- Document the tested app/protocol versions and precise visibility limits.
- Deliver a context supplement without a duplicate running session.
- Switch the foreground app during a consultation without misrouting its reply.
- Recover from log rotation, compaction, branch changes, and reconnect as supported.
- Add Claude delivery and verify the complete cross-application acceptance loop.

M2 and M3 can be developed as independent adapters against the M1 contracts.

## M4 — Usable hosted service

- Maintainer chooses hosting, spending limits, and initial exposure.
- User onboarding, project/source connection, and disconnect controls.
- Authentication, tenant isolation, bounded usage, and server-held secrets.
- Retention, export, and deletion behavior.
- Observable deployment, upgrade, rollback, and operational recovery.
- Verification from a second user's supported environment.

## M5 — Self-hosting on one computer

One-use browser pairing, an owned Mac LaunchAgent and verified backup/restore
commands are implemented. Actual installation/login/restart on the intended Mac
and the full voice/agent acceptance remain open.

- Reproducible installation and upgrade on the first supported OS.
- Same domain contracts and acceptance suite as the hosted service.
- Local capture and storage; hosted model providers remain optional dependencies.
- Hardware requirements measured on published workloads.

## M6 — Fully local inference and broader participation

- Replace reasoning and voice providers with local implementations where feasible.
- Evaluate task usefulness, speech quality, latency, and resource use against the
  same acceptance criteria; publish measured limits.
- Expand supported environments and contributor-owned adapters through a
  conformance suite.

## Evidence vocabulary

- Local checks: schemas, state transitions, deterministic fixtures, recovery tests.
- Device checks: the supported app/OS/hardware boundary works.
- Provider checks: authenticated model/voice calls and their actual results work.
- Public-service checks: the deployed service works from an external client.
- Human checks: a person confirms the intended conversational experience.

Passing a lower layer never substitutes for the next layer's evidence.
