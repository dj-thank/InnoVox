# InnoVox

**A shared context and voice layer for people working with coding agents.**

InnoVox observes conversations, relates them to a project's goals and constraints,
and offers useful context before an agent needs to ask. When human judgment is
needed, it makes that conversation available through voice and returns the answer
to the right task.

[日本語](README.ja.md) · [Run the preview](docs/operations.md) · [Mac guide](docs/platforms/macos.md) · [Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md) · [Contributing](CONTRIBUTING.md)

**The original end-to-end product is not complete.** See [requirements and acceptance](docs/requirements.md); live voice, ordinary desktop attachment, working-agent use and hosted-service acceptance remain open.

## Status

An initial **single-user preview** implements persistent conversation events,
project conditions, source-bound consultations, answers and a delivery queue.
A browser UI and selected-file Codex/Claude Code collectors are included.
Astra's real structured response and GPT Live WebSocket audio output passed a
bounded authenticated [provider check](docs/verification.md). Browser WebRTC and
human voice acceptance remain unverified. Scoped session discovery and an optional
Codex App Server delivery bridge are included; see [connectors](docs/connectors.md).
Native screen capture, Claude delivery, and universal desktop attachment remain
unimplemented or unverified. No public service is deployed.

## Run locally

Requires Node.js 24.19+ (24.x) and pnpm 11.19.0.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm init-local
pnpm start
```

Open `http://127.0.0.1:4317` and connect with the InnoVox access token generated
in `.innovox/access-token`. The explicit synthetic sample works without OpenAI
credentials. `pnpm check` runs the tests and `pnpm diagnose` reports environment
capabilities. See [operations](docs/operations.md) for provider setup boundaries,
collection, cloud deployment preparation, and current limits.

## What we are building

1. **Conversation capture:** traceable, version-aware conversation and execution
   events from supported agent sessions.
2. **Proactive assistance:** use project intent to identify context worth sharing,
   including when no AskUser or permission tool has been called.
3. **Voice collaboration:** ask concise questions, handle corrections and
   interruptions, and bind each answer to its intended task.

The initial direction is **cloud first, GPT Live for the voice experience, and
Astra for reasoning**. The selected integration approach is the **GPT Live public
API with a new InnoVox-specific API key**. The implemented browser transport is
WebRTC. A dedicated credential and bounded provider access are verified in the
development environment. Browser voice acceptance and production hosting remain open.

The long-term direction is the same product on a hosted service or one capable
personal computer. Shared behavior, exportable data, documented protocols, and
the same acceptance suite are the path to that goal. Self-hosting with cloud
models and fully offline inference are separate milestones; model quality parity
must be demonstrated, not assumed.

## Development approach

- Ship small, working vertical slices with observable acceptance criteria.
- Keep the capture, reasoning, voice, and session-delivery boundaries replaceable.
- Preserve project goals, reasons, provenance, and explicit user corrections.
- Make real integration failures visible instead of silently substituting mocks.
- Use synthetic, non-sensitive fixtures in the public repository.
- Record tested versions and distinguish local, provider, hosted, and human checks.

Start with [the roadmap](docs/roadmap.md) and [repository instructions](AGENTS.md).

## License

[MIT](LICENSE). Copyright 2026 InnoVox contributors.
