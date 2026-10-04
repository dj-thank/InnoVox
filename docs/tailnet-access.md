# Verify access on a restricted tailnet

This deployment must account for individually permitted connections. A device
being online, sharing an account with another device, or having a Serve listener
does not establish that the intended source can reach it. Read the current
policy before making a device-access claim; the exact rules are not stored in
this public repository.

Tailscale stores ACLs and grants in a HuJSON policy. Matching rules depend on the
source and destination selectors, protocol/port, and any additional conditions.
Permissions are directional. Grants are additive: adding a narrow grant does
not restrict an existing broader one. See the [policy reference](https://tailscale.com/kb/1337/policy-syntax)
and [grants reference](https://tailscale.com/docs/reference/syntax/grants).

## Separate the connections

- **Mac browser to the InnoVox host:** check the exposed HTTPS destination port.
  With Serve proxying HTTPS to a loopback backend, this is the external Serve
  port, not the Node service's loopback port.
- **InnoVox host to a Mac administration service:** this is the opposite direction
  and a separate permission. A web-service allowance does not authorize SSH.
  The policy's `ssh` section concerns Tailscale SSH; native OpenSSH also needs its
  own OS service and authentication configuration.
- **Browser to the application after network access:** InnoVox still requires its
  owner or paired-browser credential. Tailnet membership does not replace that.
- **Application to OpenAI:** provider credentials and model access are another
  independent boundary. A successful provider diagnostic does not prove Mac access.

[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) obeys access
controls like other services. Its “available within your tailnet” message means
that serving is configured; it does not mean every tailnet device is permitted.

## Review before changing policy

1. Identify the authoritative current policy and its normal review/deployment path.
   Do not replace it with an example or infer its contents from old screenshots.
2. Match the actual source device/user/tags and destination to the policy's
   selectors. Record the required direction, protocol and exposed port.
3. Inspect existing permissions and policy tests. Keep networking rules, device
   conditions, route advertisements and application authentication distinct.
4. If a permission is missing, prepare a minimal proposed change with tests for
   its intended and unintended reach. Apply it only through the authorized
   configuration/review path, preserving unrelated rules.
5. After an approved change, verify from the intended source device and record
   the observed result. A self-request from the serving host proves only that
   host's listener/TLS/application path.

A browser automation policy refusal is not evidence of an ACL denial. Do not
change routes, use another execution surface, or relax network controls to work
around a blocked tool action. Keep tool-policy review separate from tailnet-policy
review; a network-policy change does not override a browser tool restriction.

The effective policy was read on October 4 and lacked the intended web-service
permission. A minimal proposal is awaiting approval. Mac access remains unverified
until an approved rule and the actual source-to-service path are checked. Server
health and CI cannot close that item.
