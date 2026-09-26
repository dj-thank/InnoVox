# Delivery roadmap

Every milestone needs a runnable demonstration and explicit acceptance evidence.
The order below expresses product intent, not a claim that these features exist.

## M0 — Public project foundation

- [x] Public GitHub repository exists.
- [x] Product direction and development instructions published.
- [x] MIT License selected and published.
- [x] GPT Live public API and a new InnoVox-specific key selected.
- [ ] Secure key provisioning and authenticated provider access verified.
- [ ] First implementation stack and its reasons recorded.

## M1 — A reliable conversation-to-consultation slice

Input: synthetic conversation events and explicit project conditions.
Output: a source-bound consultation and a correctly routed, durable answer.

- Versioned events and a replayable journal.
- Project conditions with source, scope, reason, and revision.
- Consultation lifecycle, corrections, expiration, and reply binding.
- Idempotent ingestion and delivery intent; visible unknown outcomes.
- Contract tests for duplicates, out-of-order input, stale replies, and restart.
- A small inspection surface exposing the actual state.

Synthetic fixtures establish local behavior only. They do not prove Astra
reasoning, GPT Live voice, or a supported application's integration.

## M2 — GPT Live + Astra, real end-to-end

- Supported, authenticated GPT Live connection.
- Astra receives only the relevant conversation/project context.
- A useful proactive question occurs without an AskUser event.
- A spoken answer reaches the intended task and its receipt is observable.
- Natural consecutive turns, interruption, and correction are checked by a person.
- Provider failure and reconnection preserve task state without duplicate effects.

## M3 — One real session connector

- Observe an existing supported Codex or Claude Code session.
- Document the tested app/protocol versions and precise visibility limits.
- Deliver a context supplement without a duplicate running session.
- Switch the foreground app during a consultation without misrouting its reply.
- Recover from log rotation, compaction, branch changes, and reconnect as supported.

M2 and M3 can be developed as independent adapters against the M1 contracts.

## M4 — Usable hosted service

- Maintainer chooses hosting, spending limits, and initial exposure.
- User onboarding, project/source connection, and disconnect controls.
- Authentication, tenant isolation, bounded usage, and server-held secrets.
- Retention, export, and deletion behavior.
- Observable deployment, upgrade, rollback, and operational recovery.
- Verification from a second user's supported environment.

## M5 — Self-hosting on one computer

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
