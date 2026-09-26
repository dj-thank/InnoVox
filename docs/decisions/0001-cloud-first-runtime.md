# ADR 0001: TypeScript service first, native companion later

Status: accepted for the first preview. Date: 2026-09-26.

## Context

The maintainer prioritizes a working cloud experience, GPT Live voice, Astra
reasoning, public development, and eventual one-computer operation. The same
domain behavior must survive different hosting and capture implementations.

## Decision

Start with TypeScript on Node.js 24, native SQLite for the single-instance
journal/projections, a small browser UI, and explicit HTTP provider adapters.
Use Zod for runtime validation and structured reasoning output. Pin dependencies
and check Linux, macOS, and Windows in CI.

The standard HTTP adapters isolate a small number of documented OpenAI methods;
the provider-specific response shapes do not enter the domain store. They can
be replaced with an official SDK without changing consultation identity/state.
Live access must be tested before claiming provider support.

Ship a selected-file conversation collector before broad desktop observation.
For a later Mac native capture companion, evaluate Swift with ScreenCaptureKit
and Accessibility APIs behind the existing language-neutral event contract.
Rust remains a candidate for shared native capture/state work. Do not add either
runtime to the cloud service solely for perceived inference speed.

## Consequences

- One service runs on a cloud host or personal computer; model providers remain
  external in this phase.
- Native SQLite is suitable for this single-instance preview; multi-tenant or
  multi-replica hosting needs additional ownership/storage design.
- Native desktop capture and direct session input remain independent adapters,
  not implied by reading a log or by receiving a WebRTC answer.
- The initial browser UI is intentionally small. Use measured behavior to decide
  whether a frontend framework or additional message infrastructure is needed.
- Node's SQLite API maturity and supported runtime versions must be reviewed at
  upgrade time; current tests pin Node 24.19 and later 24.x only.
