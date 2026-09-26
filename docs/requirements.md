# Original requirements and acceptance

Source: the maintainer's design discussion and corrections, 2026-09-25–26.
This document separates that intended product from the smaller implementation
slices proposed during development. Those slices do not redefine completion.

## Intended experience

InnoVox continuously understands the connected coding conversations and project
intent. Before an agent asks for help, Astra identifies information worth sharing
or a useful question for the person. The person can discuss it through voice,
correct it, and have the scoped answer reach the right working agent even after
switching between Codex and Claude.

The product also serves as a voice frontend for requests for human work.
Question forwarding after AskUser is one possible input, not the central trigger.

## Requirements and current status

### R01 — Read conversations and screens promptly

The requested inputs include structured conversation data and the visible work
context. Current code follows selected Codex/Claude Code JSONL files and can
discover/backfill/watch matching sessions within explicit roots and workspace
metadata. Bounds, skipped files, ambiguity and actual message imports are reported
separately. It does not attach to every desktop app or capture screens. Live
capture latency and broad application-version coverage are not measured.

Status: partial. See `src/capture.ts` and the Mac guide.

### R02 — Intervene before AskUser

Automatic analysis can be triggered by ordinary conversation events. The current
reasoner proposes a human question; it does not yet choose among quiet context
injection, advice to the user, a human work request, and a spoken question.
Live usefulness and unnecessary-interruption rates are unverified.

Status: partial, not end-to-end accepted.

### R03 — Preserve the project's important context

Manually entered conditions and their reasons are versioned. The current context
builder includes complete selected statements and connected peer-session records
from the same project, with qualified evidence IDs. It reports budget omissions
instead of cutting off each statement's tail.

Automatic extraction of enduring goals from project documents/history, explicit
exception/supersession semantics, and retrieval across all older history remain
open. A saved voice answer is not automatically promoted to permanent policy.

Status: partial. Recent-context handling is locally tested; durable intent
maintenance and broad retrieval are not implemented.

### R04 — Astra is the reasoning head; GPT Live is the voice frontend

Astra handles proactive analysis and contextual spoken follow-ups. The original
4o assumption was corrected to Astra. GPT Live client delegation now calls the
voice interpretation backend rather than returning a fixed placeholder sentence.

Status: implemented boundaries, synthetic contract verification and a bounded
authenticated provider check. Astra produced a validated structured proposal and
GPT Live produced nonzero audio over WebSocket. Browser voice and actual human
conversation remain unverified.

### R05 — Confirm through voice

The implementation prepares a source-bound answer, reads it back, and accepts
an explicit subsequent spoken confirmation. The client must observe the read-back
context acknowledgment before the backend permits confirmation. That acknowledgment
is not evidence of playback or human understanding. Corrections replace the
candidate, and a new interpretation invalidates an older uncommitted confirmation.

The synthetic controller/HTTP/provider-adapter/store test exercises this path
without a save-button click. A voice conversation is still started from the UI;
continuous listening, automatic announcement of new questions, natural speech
timing, and real human acceptance remain open.

Status: partial. No claim of a fully hands-free production experience.

### R06 — Return answers and useful context to the working agent

Answers now include the question, rationale, and evidence in their delivery text.
The queue retains the destination session/epoch and rejects stale context.
An optional Codex App Server bridge now verifies a loaded target and either
steers an active turn or explicitly appends context for a later turn. The latter
was verified against an isolated installed Codex runtime and its persisted log.
This is not proof of active model use or ordinary desktop attachment. Claude
delivery remains absent. Copying text is not a delivery receipt.

Status: partial; native transport/persistence is verified in the bounded test,
while actual working-agent and whole-product acceptance remain open.

### R07 — Understand surrounding sessions and survive app switching

Related records from sessions already connected to the same project can inform
Astra. Response binding does not depend on the foreground window. Automatic
startup discovery/backfill inside explicit roots is now implemented. Semantic
association across arbitrary workspaces, actual Codex-to-Claude switching,
desktop attachment, and complete working-agent readback remain open.

Status: partial. Scoped metadata discovery is not a working cross-application loop.

### R08 — Open interfaces, version handling, robust operation, speed

Versioned JSON schemas, explicit source IDs/epochs, durable state, bounded model
admission, and selected recovery tests exist. MCP/ACP integration, comprehensive
vendor capability negotiation, stream-gap reconciliation, and measured latency
targets remain open. Rust/TypeScript discussions were design proposals; the first
service uses TypeScript as recorded in ADR 0001.

Status: partial. Fixed dependencies and passing CI alone do not establish
cross-version integration or responsiveness under real workloads.

### R09 — Cloud first, usable by other people

The same service has a tested container build. It is a single-user preview,
not a deployed multi-user cloud service. Identity, isolation, quotas, provider
credential setup, deployment destination, and operating budget must be addressed
before that stage is accepted.

Status: not delivered. The GitHub repository's public visibility is separate.

### R10 — One-computer operation and quality parity

The server/runtime checks pass on Windows, Linux and Apple Silicon macOS.
The target includes one-computer operation; fully local inference, speech models,
hardware requirements, and comparative quality are future measured milestones.

Status: architecture direction and partial runtime portability, not quality parity.

### R11 — Public development and license

The repository and source are public. The maintainer's final license choice is MIT,
superseding the earlier Apache-2.0 choice. The selected provider route is the public
API with a new InnoVox-specific key. Protected runtime configuration and bounded
authenticated Astra/GPT Live access have been verified in the development environment.

Status: repository/license delivered; development credential and provider checks verified.

### R12 — Understand Mac capabilities and settings

The Mac guide separates browser voice, local logs, future ScreenCaptureKit/AX
capture, and OS permissions. CI validates the common runtime on Apple Silicon;
it does not validate microphones, screen recording, permission dialogs, Intel
Macs, or sleep/wake behavior.

Status: documented and partly runtime-tested; native/device acceptance open.

## Critical acceptance scenario

1. Connect actual Codex and Claude sessions for one project, including an existing
   important project condition. Identify what has and has not been read.
2. Let one agent begin a conflicting plan without calling AskUser.
3. Have InnoVox surface the relevant condition in time, explain its source, and
   ask a useful question through voice when needed.
4. Ask a contextual follow-up aloud; Astra must answer from the project's evidence.
5. Give a correction and confirm the read-back answer through voice.
6. Switch to the other application while replying. Deliver the answer and its
   scope to the original intended session exactly once, or expose an unknown
   outcome without blind resend.
7. Observe that the working agent actually received and used the input.
8. Repeat with interruption/reconnect and a changed project decision; no outdated
   answer, duplicated effect, or feedback loop may be silently accepted.

This scenario has **not passed**. A successful synthetic version is only a lower
evidence level. Do not mark this product complete because unit tests, a container,
or a Mac CI job passed.

## Corrective work order

1. Keep the local corrections covered: stale questions, whole-record context,
   qualified cross-session evidence, voice interpretation/readback/confirmation,
   and complete answer envelopes.
2. Complete the first real agent delivery adapter and observe its receipt.
3. Validate browser WebRTC and perform the actual voice/agent loop above using
   the now-verified provider configuration.
4. Add persistent voice presence, validate scoped session discovery in actual
   use, then measure intervention value and response latency.
5. Deliver the public hosted experience, then extend self-hosted/offline parity.

Native screen capture is an independent input adapter. Its absence and the other
open requirements stay visible while the first connected loop is built.
