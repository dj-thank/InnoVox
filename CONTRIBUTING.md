# Contributing

InnoVox is being developed in public. The first implementation and source-code
license are being established; please check the README before relying on either.

## Propose work

Describe the user-visible problem, the relevant milestone, one bounded change,
and how someone can verify it. Include the supported environment/version when
reporting an integration problem. Do not include private conversations or keys.

## Implement work

Read `AGENTS.md` and the relevant design documents. Keep source observations,
interpretations, and confirmed decisions distinct. Prefer a small working
vertical slice over a broad scaffold with no verified behavior.

Use synthetic fixtures to reproduce edge cases. State which checks use real
applications/providers and which are simulated. New compatibility claims require
versioned evidence and adapter contract tests.

## Submit a change

Explain the problem, resulting behavior, validation, and remaining limitations.
Update documentation when the actual interface or architectural decision changes.
Keep credentials, raw user histories, recordings, and local paths out of commits.

External contributors should wait for the source-code license to be established
before submitting code. No contributor license agreement is currently defined.
