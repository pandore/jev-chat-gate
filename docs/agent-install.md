# Install with an agent

This guide is for a coding agent whose owner wants selective participation in a
group chat. You need access to the host's code or supported plugin interface,
terminal, and configuration. An agent that can only exchange Telegram messages
cannot install this integration by itself.

The repository provides the gate, a Jev HTTP evaluator, and an offline demo.
It does **not** contain a ready-made OpenClaw or Hermes plugin. You will need to
implement a host adapter. Start with the smallest integration your host supports;
reuse its conversation handling, answering model, credentials, and transport.

## Intended behavior

- A tag or a verified reply to the agent uses the direct answering path without
  Jev relevance scoring. Participation modes, dedupe, and bot budgets still apply.
- Without a tag, Jev considers an unresolved request or concrete value, while
  checking whether the agent would intrude or repeat an existing answer.
- An admitted message allows the main model to consider a reply. It can still
  choose silence. The gate neither writes the answer nor authorizes tools.
- A newer reply on the same branch can stop an ambient draft before delivery.
- Quiet mode allows direct requests only; off mode blocks new text participation.

Success means useful help without requiring a tag, with predictable direct
requests and deliberate silence. More responses alone do not establish success.

## 1. Inspect the host before changing it

Identify the installed framework/version, the owner-authorized chat scope, the
current mention policy, and the actual incoming-to-outgoing message path. Read
the installed source or documentation for that version, rather than guessing
hook signatures from another release. Preserve unrelated work and configuration.
Record the original routing and completion settings before changing them so
rollback can restore that baseline; keep any configuration containing secrets
in the host's private storage.

Check that the host can:

1. Receive authorized group messages without a mention, with stable source IDs,
   sender identity/kind, mention metadata, and reply links.
2. Stop an ambient turn **before** the answering model, typing, and tools start.
3. Observe newer messages while evaluation or generation is running.
4. Gate every outbound path, including streaming, chunking, retries, and tools,
   and finish an ambient turn silently without an error placeholder.
5. Return confirmed platform message IDs and bind the source event, model run,
   gate token, and receipt in trusted host state.

| Host | Integration direction |
| --- | --- |
| OpenClaw | Build a native plugin using the installed version's verified pre-reply, outbound, and delivery boundaries. There is no stock plugin in this repository. |
| Hermes | Build a Python-side adapter and a bridge to the JavaScript core, or a separately verified port. Observer/logging hooks alone cannot enforce participation. |
| A custom JavaScript agent | Import the core into the existing message handler and delivery path. |
| Another or closed runtime | First establish access to equivalent boundaries. A Telegram connection by itself is insufficient. |

If a required boundary is missing, report exactly what is missing and what adapter
or runtime change would be needed. Do not substitute a prompt saying "reply only
when useful," disable authorization, or let sends bypass the gate. Prefer native
extension points; this repository supplies no patches for compiled framework
files. Do not claim compatibility merely because an import or hook registration
succeeded.

## 2. Run the reference implementation

In a separate directory, with Node.js 22 or newer:

```sh
git clone https://github.com/pandore/jev-chat-gate.git
cd jev-chat-gate
npm test
npm run demo
```

These commands use synthetic data, need no credentials, and post nothing to a
chat. They check the core, not your host adapter. For a JavaScript host, install
the tagged package into its integration project:

```sh
npm install github:pandore/jev-chat-gate#v0.1.2
```

The installation guide is maintained on `main`; older release tags may not include
it. The package is not published to the npm registry. The hosted evaluator needs
`TYPESAFE_API_KEY`; use the host's private secret storage and keep the key out of
prompts, logs, and Git. If it is missing, ask the owner to configure it there.
`npm run demo -- --live` uses provider quota and sends only the synthetic demo
context to TypeSafe; it still does not post to a chat.

In a live integration, hosted Jev receives the capability profile and up to 12
filtered chat messages. Default filtering does not remove every sensitive detail;
match the host's data-sharing rules and use a custom filter or evaluator if needed.

## 3. Connect the three boundaries

Read [the integration contract](integration.md) and the [README API example](../README.md#integrate).
They are authoritative for event fields and lifecycle details.

- **Incoming:** after host authorization, construct the trusted event and call
  `admit`. Only `consider` may start the answering path. Use `observe` for
  context-only traffic; keep observing newer ingress during generation. Normalize
  original creation times to `timestampMs`. Forward trusted edit events with
  `edited: true` to update context and cancel affected drafts, not to auto-answer.
- **Before sending:** keep the returned token bound to its host run. On an empty
  answer or `NO_REPLY`, call `cancel` and complete silently. Otherwise call
  `takeSendPermit` immediately before the transport call and suppress output if
  it is denied. One token permits one platform message attempt.
- **After sending:** call `recordSent` only with the actual platform receipt and
  sent text. On a failed or uncertain send, do not blindly retry the token.

Use one gate and private state file per platform/account/conversation/thread,
with exactly one owner per file. Derive both address flags and sender kinds from
trusted host routing, never from model output. Use a short capability profile
describing what this agent can actually contribute; thresholds are starting
values from one community, not universal calibration.

Preserve access controls, tool permissions, the answering model, and direct-chat
behavior. Limit the change to the requested group scope. Receiving unmentioned
messages must route them through the gate, not enable unrestricted replies.
Verify the host's native completion policy: deliberate ambient silence must not
produce a "no visible reply" error. Direct requests keep required-answer recovery.

## 4. Verify the adapter, then enable participation

First exercise the adapter with external sends and side effects disabled for the
test runs. Record decisions and cancel admitted test runs. Once this works, use a
private test chat with synthetic messages to check real delivery. Do not send
unsolicited test messages to a public community or upload its history as a fixture.

Use the [minimum adapter acceptance cases](integration.md#minimum-adapter-acceptance).
In particular, check a direct request; intentional silence; an admitted untagged
request with one receipt; a human reply while the agent drafts; duplicate ingress;
quiet/off mode; and an uncertain send or restart without an automatic second send.
Check account, chat, and topic isolation. Package tests alone do not cover these
host behaviors. Include a source edit while drafting and an old replay with a
platform timestamp. Handle `run_capacity` as overload; do not bypass the gate.

Keep the initial rollout in the owner's requested scope. Review missed useful
requests and unwanted interruptions before adjusting the profile or thresholds.
The [participation approach](approach.md#evaluate-the-experience-not-just-the-gate)
explains how to assess conversational quality separately from routing checks.
Reactions and automatic roles are optional work outside this package.

For rollback, follow [the removal procedure](integration.md#minimum-adapter-acceptance):
stop new participation, drain active work, and restore the saved baseline routing.
Do not remove a gate while leaving unrestricted ambient answering enabled.

## 5. Give the owner a concrete result

Report the installed runtime/version, adapter location, enabled scopes, and
whether a provider credential is configured, without revealing its value. List
the behaviors you verified, actual delivery evidence, any remaining limitations,
and the quiet/off and rollback controls. State whether you only ran the demo,
built an adapter, verified a private chat, or enabled the requested scope.
If blocked, name the missing capability and the smallest next step.
