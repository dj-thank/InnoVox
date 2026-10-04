# Bounded provider checks

`pnpm provider-check` uses the same Astra reasoning adapter as the service and
validates a synthetic proposal against its supplied evidence. It does not use
private conversations. It needs the existing server-side `OPENAI_API_KEY` from
the environment or the ignored `.env.local`. A missing key exits without making
a provider request; a configured key is never printed.

```sh
pnpm provider-check --live --report .innovox/provider-check.json --audio .innovox/provider-check.wav
```

Add `--voice-dialogue` to make one additional Astra request with a synthetic
previous exchange and the relative answer “the second option.” It checks draft
interpretation from the supplied dialogue and does not commit an answer. This
flag exercises reasoning access and a bounded semantic case; it still does not
open a microphone or validate a real person's conversation.

This explicit command performs real API work and may consume API credits:

- One Astra request with the adapter's bounded output limit.
- With `--voice-dialogue`, one additional Astra request with the same output bound.
- With `--live`, one GPT Live primary WebSocket session using the official SDK,
  synthetic paced silence and a short generated greeting.
- The voice check requests closure within 20 seconds and allows up to 10 seconds
  for finalization. Automatic reconnection is disabled.
- Audio bytes/nonzero samples, session start and final usage are recorded
  separately. A transport failure is not silently called a successful close.

The optional WAV is generated provider output, not microphone input. The check
does not open a microphone, record the person, or establish human acceptance.
It also does not establish that browser WebRTC, real speech recognition, or an
actual Codex/Claude task works end-to-end. SDK dependencies for this diagnostic
are development dependencies; use a development installation for the command.

Keep credentials in private local/server configuration. Do not paste them into
chat, browser application fields, command arguments, public source, reports, or
audio artifacts. Reuse a securely configured project credential rather than
creating a new key for each run.

Protocol source: [OpenAI GPT Live WebSockets](https://developers.openai.com/api/docs/guides/voice-websockets?api=live).
