# Verification record

Date: 2026-09-26. Scope: the first single-user conversation/consultation preview.

## Local evidence

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

## Remaining evidence

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
- No native macOS screen/accessibility component or automatic agent-session
  input adapter is shipped. Mac OS permissions and audio are not device-verified.
- No public hosted service or paid cloud resource was deployed.

For the current implementation boundary, see [operations](operations.md),
[roadmap](roadmap.md), and [Mac acceptance](platforms/macos.md).
