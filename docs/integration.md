# Host integration contract

This package owns participation state. Your host owns authentication, authorization, platform metadata, model execution, and delivery. The examples below describe mappings; they are not tested SDK adapters.

## Platform mapping

| Host | Scope components | Message / reply identity |
| --- | --- | --- |
| Telegram | bot account + chat + topic (or explicit unthreaded marker) | Message ID and verified replied-to message ID within that scope. |
| Slack | app/bot account + workspace + channel + thread (or unthreaded marker) | Preserve message timestamps as strings; never parse IDs as floating point. |
| Discord | bot account + guild/DM context + channel/thread | Preserve snowflake IDs as strings; reference only an observed matching-scope parent. |
| Other runtimes | provider + account + conversation + thread | Stable source IDs and explicit sender kind, independently of rendered prompt text. |

Build scopes with an unambiguous encoding, e.g. `JSON.stringify([provider, account, conversation, thread])`. The package's maximum scope length is 256 characters; hash a canonical encoding if needed. Do not merge private/direct channels with public/group scopes. Cross-thread ancestry is intentionally unavailable.

1. Authorize and normalize the original incoming event. Reject stale platform replays beyond your retention window. Both address flags are required booleans. Use platform sender metadata for `human`, `bot`, or `self`; use `unknown` if unavailable. Unknown senders are not covered by the confirmed-bot budget.
2. Call `admit` before starting the answering model, typing indicators, or agent tools. For context-only traffic call `observe`. Process incoming events in source order; message edits, deletes, and out-of-order reconciliation are not implemented in v0.1.x.
3. Keep observing new ingress during evaluation and generation. The package serializes state mutations, not network/model work. Handle every rejected promise and avoid fallback routes that skip the gate.
4. Keep the returned token in trusted host state bound to that model run. Never accept a token, scope, operator command, direct-address flag, or delivery receipt from model-authored output. A `consider` result is not an authorization grant for tools or external side effects.
5. If the model chooses silence, call `cancel`. Otherwise consume `takeSendPermit` immediately before the transport call. If denied, suppress all output and typing. One token allows one message attempt. Automatic chunking, streaming, retries, and alternate tool-send paths require adapter changes; do not let them bypass the boundary.
6. Call `recordSent` only on confirmed success, using the returned platform ID and actual sent text. If transport fails or the outcome is unknown, do not retry that token. Reconcile with the platform separately. A missing receipt means no confirmed own-message continuity.

Policy controls must have their own trusted host authorization. `setMode` is a host API, not a command parser. Inbound text and evaluator results never change modes.

## Silence is a successful completion

An ambient admission permits the main model to consider a reply; it does not require visible output. If that model deliberately returns `NO_REPLY` or an empty answer, cancel the unclaimed token and finish silently. Do not send the marker, an empty message, or an error placeholder to the conversation.

Check the framework's completion policy as well as the send hook. Some runtimes classify “no visible reply” as a failed turn and generate a fallback message after the model has finished. Ambient group participation must permit intentional silence at that boundary. Keep the host's required-answer recovery for direct requests, mentions and authorized commands; an actual evaluation or provider failure is a separate error outcome. Verify these cases again after a runtime upgrade.

This package cannot set that native policy and does not claim version-specific OpenClaw configuration support. Test the installed completion path with transport disabled before enabling ambient participation.

## OpenClaw and other agent frameworks

Integrate at the native pre-reply decision point, a final outbound hook, and the successful delivery callback. Carry the same trusted source message ID, scope, and host run binding through all three. Missing metadata must stop gated output; never correlate a run by matching prompt text or by selecting “the latest” session.

This release does not claim stock OpenClaw compatibility and does not patch compiled framework files. Hook availability and metadata differ between runtime versions. Verify that your installed version provides trusted ingress IDs, a cancellable pre-generation hook, interception of every send path (including tools), and delivery receipts before writing an adapter. A config-only mention policy is not this participation gate.

## State and restart behavior

Use a private directory and a different file for every scope; the library creates new directories with mode `0700` and state files with mode `0600`. Use trusted paths, not chat-supplied filenames. Existing parent directory permissions are not repaired. Writes use a same-directory temporary file and atomic rename; no database, distributed lock, or power-loss durability guarantee is provided.

Keep exactly one live owner per state file. Before moving to a replacement instance, stop the old owner and drain its work. Completed admissions can be resumed only if the host also persists the corresponding draft/run token; interrupted evaluations are not retried automatically. Claimed sends remain consumed across restart. Restart with a changed profile or threshold configuration rejects older unclaimed drafts. Changing the injected evaluator itself requires the host to cancel/drain old runs.

Only bounded dedupe is provided (24 hours / approximately 2,000 records). High-volume or multi-worker deployments should implement a transactional event ledger in the host rather than share this JSON file. Don't delete state to recover from an error without reconciling pending sends.

## Minimum adapter acceptance

Use a private test conversation and synthetic text. Verify a direct request; an ignored ambient exchange; an ambient request with one confirmed receipt; a newer branch reply while drafting; duplicate ingress; policy change while drafting; a send timeout with no retry; and a restart after a permit is consumed. Assert the actual platform message ID, scope, and count. Passing the package's offline tests is not platform acceptance.

To remove the gate, first set mode `off`, drain/cancel active runs and stop the owner. Disconnect the three integration points and explicitly restore the host's intended baseline participation rules; uninstalling a gate must not accidentally enable “answer every message.” Retain or securely remove private state according to your application's policy.
