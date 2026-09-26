# Product direction

## Purpose

Help a person keep coding agents aligned with the project's intent while reducing
the effort of restating context, finding waiting sessions, and typing decisions.

Two reusable capabilities form the foundation:

1. Extract accessible conversations and execution events faithfully, with source
   identity, chronology, completeness, and version information.
2. Consult a person through voice and deliver their answer to the correct task.

Astra connects these capabilities by comparing ongoing work with project intent
and proposing useful context before the coding agent explicitly asks for help.

## Product commitments

- Preserve goals and the reasons for constraints, not just past implementation.
- Distinguish explicit decisions, temporary exceptions, preferences, and inference.
- Incorporate corrections without silently rewriting historical evidence.
- Make proactive intervention selective. Background context, visible suggestions,
  and spoken questions have different interruption costs.
- Keep task continuity when the user switches applications.
- Allow human work requests, design choices, corrections, and factual questions;
  the voice channel is broader than an approval dialog.

## Delivery order

1. A reliable cloud-first experience operated by the maintainer, initially using
   GPT Live for voice and Astra for reasoning.
2. A hosted service that other people can actually use, with onboarding,
   isolation, account controls, usage limits, and documented support boundaries.
3. An accessible contributor workflow and self-hosting route using the same
   contracts and acceptance suite.
4. One-computer operation, including a separately evaluated fully local inference
   route where suitable hardware and models can meet the quality bar.

Public development starts immediately. A source repository, an open-source
license, and a usable hosted service are independent deliverables.

## Deployment parity

Parity means the same event semantics, project-decision rules, reply binding,
recovery behavior, and acceptance suite across deployments. Infrastructure may
differ. A change of model or voice engine requires a fresh quality evaluation.

"Self-hosted" can still use hosted models. "Fully local" means capture, storage,
reasoning, speech recognition, and speech generation operate without cloud APIs.
Neither means a proprietary model's weights are available locally.

## Out of scope for the first usable release

- Supporting every application, OS, and historical log format.
- Claiming access to hidden model reasoning or inaccessible session content.
- Unrestricted desktop automation, automatic publication, or credential handling
  based only on text found in a conversation.
- A promise of identical model quality on arbitrary hardware.

## How we evaluate value

- Important project conditions preserved or surfaced in time.
- Useful interventions and avoided rework, with user feedback.
- Unnecessary spoken interruptions per active working hour.
- Correct question-to-answer-to-task binding.
- Time from a relevant event to a useful suggestion, measured separately from
  capture, model inference, speech onset, and answer delivery.
- Recovery after disconnection, restart, correction, and session branching.

## Confirmed integration choice

Use the GPT Live public API and create a new API key dedicated to InnoVox.
GPT Live remains the initial voice provider and Astra the reasoning head.
This selects the integration and credential approach; it does not establish
that a key has been created or that authenticated provider access works.

## Maintainer decisions still required

- Initial hosting environment, service exposure, and operating budget.

These are deployment/ownership choices, not permission to put credentials or
private conversations in the public repository.

Credential provisioning and a bounded authenticated integration check remain
execution work under the selected approach. The first browser voice transport is
WebRTC with server-side HTTP session creation. Wire compatibility still requires
a live check.
