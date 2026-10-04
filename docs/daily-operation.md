# Single-user operation and Mac readiness

The operational tools below prepare the preview for repeated use. They do not
establish that the original cross-application voice loop or a public multi-user
service is production-ready. Keep the [original acceptance](requirements.md) open
until the actual device, voice and working-agent checks pass.

## Pair a browser without sharing the owner credential

Start the server, then run `pnpm pair` on its host. Open the displayed URL in the
browser and enter the eight-digit code. The code is one-use, lasts five minutes
and is invalidated after five wrong attempts. Issuing a new code replaces the old
one. No OpenAI API key enters the browser.

The browser receives a separate credential lasting twelve hours. Logout revokes
it. Server restart invalidates these credentials and outstanding pairing codes.
Only the owner access token can issue codes; paired browsers cannot issue more.
This remains one owner workspace, with at most sixteen browser connections, not
tenant isolation. A paired browser can access the workspace's conversations and
actions. The existing owner token still supports trusted local collectors.
When abandoned tabs fill the sixteen-session pool, `pnpm pair --revoke-all`
explicitly revokes every paired browser credential. The owner token is retained.
Issue or reuse an unexpired code afterward. A valid code is not consumed merely
because the pool is full. Paired browsers cannot request this owner operation.

`pnpm pair` normally contacts the loopback server at `INNOVOX_PORT` and displays
`INNOVOX_ORIGIN` when configured. An explicit remote `--url` requires the intended
owner token through `INNOVOX_ACCESS_TOKEN`; the CLI does not send a local token
to an arbitrary remote origin automatically. Use HTTPS for remote browser access.
For a restricted tailnet, complete the [access-policy review](tailnet-access.md)
before assuming the browser can reach the exposed service.

## Start after Mac login and recover from process failure

After the normal install/build and `pnpm init-local`, run as the signed-in Mac
user, without `sudo`:

```sh
pnpm mac-service install
pnpm mac-service status
pnpm pair
```

The generated user LaunchAgent binds one checkout and the exact Node executable.
It loads `.env.local` at process startup, so secrets are absent from launchd
arguments and its plist. Logs and an ownership receipt are kept in
`.innovox/service`. The agent starts after login and restarts a failed process,
with a thirty-second throttle. It does not keep a sleeping laptop awake or run
before the user signs in. This follows Apple's [user agent lifecycle](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html).

`pnpm mac-service stop` unloads only the matching, verified service; `start` loads
it again. Before a stop, its current PID and creation time are checked for a
change. Stop does not delete the LaunchAgent, state, logs or keys; the file remains
eligible for the next login. There is no global process-name kill or replacement
of unrelated services. A changed ownership receipt, plist or runtime path stops
the operation for review. Keep the checkout and runtime path stable.
New installations retain an owner-bound intermediate receipt when interrupted;
retrying `install` resumes only matching staged bytes/inodes. Unknown or altered
files are preserved for review. Stages are beside their destinations so the
checkout and user LaunchAgents folder may be on different local volumes.

For an update: stop the service, create a verified backup, update the checkout,
install locked dependencies, build/check, start the service, then verify the
actual browser and connector path. `status` reports launchd lifecycle fields;
it is not a provider, HTTP, microphone or whole-product health result.

## Back up and rehearse recovery

```sh
pnpm backup
pnpm backup --restore .innovox/backups/SELECTED.sqlite --output .innovox/restore-check.sqlite
```

The online SQLite backup includes committed WAL state, performs integrity/schema
checks and writes a companion manifest containing the byte count and SHA-256.
Existing files are never replaced. Keep the database and its `.manifest.json`
together. Backups contain private conversations and decisions; keep them private.
They do not copy `.env.local` or access-token files. POSIX files are created with
owner-only permissions; Windows installations must also enforce filesystem ACLs.

Restore verifies the manifest and database, writes a new destination and reports
`activated: false`. It never swaps the live database automatically. After stopping
the service, explicitly select the restored database through `INNOVOX_DATABASE`
to activate it. On startup, an in-flight delivery becomes `unknown`, so recovery
does not resend an action whose result may already exist. Provider access,
connectors and the person's conversational experience still need their own check.

## Check the actual Mac

If the task runs on a different computer, Mac CI cannot stand in for this step.
Run `sh scripts/macos-check.sh` on the Mac, or run the separately supplied copy.
It saves a new report beside the script with OS, architecture, RAM, hardware
model, login name and tool/directory presence. It does not read credentials or
conversation contents, enable remote access, change settings, or test microphone
and screen permissions. Treat the report as private device metadata.

Before calling this a usable installation, verify all of the following on the
intended Mac: real browser WebRTC, spoken clarification/correction/confirmation,
actual Codex/Claude observation and delivery, switching apps without misrouting,
login/restart and sleep/reconnect recovery, restoration from a backup, and measured
response latency. Native screen capture, Claude delivery, always-on voice presence
and server-enforced voice termination remain separate unfinished requirements.
