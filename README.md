# InnoVox

**A shared context and voice layer for people working with coding agents.**

InnoVox observes conversations, relates them to a project's goals and constraints,
and offers useful context before an agent needs to ask. When human judgment is
needed, it makes that conversation available through voice and returns the answer
to the right task.

[日本語](README.ja.md) · [Product](docs/product.md) · [Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md) · [Contributing](CONTRIBUTING.md)

## Status

This repository is at the project-foundation stage. It does not yet contain a
working hosted service, a live GPT Live integration, or a desktop connector.
Public source availability is separate from a publicly available service.

## What we are building

1. **Conversation capture:** traceable, version-aware conversation and execution
   events from supported agent sessions.
2. **Proactive assistance:** use project intent to identify context worth sharing,
   including when no AskUser or permission tool has been called.
3. **Voice collaboration:** ask concise questions, handle corrections and
   interruptions, and bind each answer to its intended task.

The initial direction is **cloud first, GPT Live for the voice experience, and
Astra for reasoning**. The first supported transport, credentials, and production
hosting must be selected and verified before a live integration is claimed.

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

The project license is awaiting the maintainer's selection. No open-source license
is granted yet. A public repository alone is not a license grant.
