# Jev Chat Gate

**Useful AI participation, with room for human conversation.**

Jev Chat Gate helps an AI assistant choose when to join a group conversation. People can talk to each other, ask the agent directly, and continue a useful exchange without every message starting the answering model.

The agent gets two opportunities to stay quiet: before it starts an unsolicited answer, and before it sends a draft that may have become unnecessary. Your main model still writes the answer and can choose silence too.

## What changes in the agent's behavior

| Integration pattern | Behavior with Jev Chat Gate | Intended benefit for people |
| --- | --- | --- |
| Start the answering model for every message. | Evaluate intrusion, redundancy, an open request and concrete value before starting an unsolicited answer. | More room for conversation between people; fewer opportunities for unwanted commentary. |
| Start the agent only after a mention. | Open group questions can be admitted without a mention; observed dialogue context can support an unmentioned follow-up. | People can get help and continue an exchange without repeatedly calling the bot. |
| Send every completed draft. | Recheck the ambient draft's reply branch, freshness and current policy before sending. | A person replying while the agent drafts can prevent a redundant message. |
| Ask the model to be quiet through its prompt. | Quiet mode admits direct requests only; off mode blocks new text participation. | A predictable way to reduce agent activity. |

Direct requests and replies to confirmed assistant messages bypass relevance scoring while respecting mode, duplicate and bot-budget controls. The gate changes **when the agent may participate**. Answer quality, personality and factual accuracy still depend on your answering model and its context.

## A result you can reproduce

The included [offline demo](examples/demo.js) runs one small conversation:

1. An unanswered group question is admitted for consideration.
2. A person replies to that question before the agent sends. The agent's send permit is denied.
3. Quiet mode is enabled. A direct request to the agent is still admitted.

```text
Group question: consider unresolved_request
Another person replied while drafting: reply_branch_changed
Direct request in quiet mode: direct
Demo finished. No messages sent to any chat.
```

This demonstrates a concrete behavior change: an admitted draft does not automatically become another message in the chat. The demo uses synthetic scores, so it verifies control flow rather than Jev's conversational judgment.

The [tests](test/gate.test.js) also verify duplicate suppression, follow-up context, mode changes, bot-turn budgets, evaluator failures and send-permit behavior across restarts. These checks establish routing and lifecycle behavior. Real participant experience still needs review in your community: unwanted interruptions, missed useful requests, coherent follow-ups and confirmed delivery. We do not claim a universal accuracy score or measured participant-satisfaction improvement.

## Where it fits

- **Community chats:** technical questions, shared experience and discussions between members.
- **Team and project chats:** help on open questions while people continue their own work.
- **Learning groups:** explanations when someone needs them, with room for peer answers.
- **Client-and-team groups:** participation within the context and permissions provided by your host.

It is most useful where participation is optional. In a one-to-one support conversation where every message expects an answer, relevance gating has less work to do.

You can integrate it with Telegram, Slack, Discord or another transport that provides trusted message identities and reply links. This repository provides a framework-independent JavaScript core, **not ready-made platform adapters or an OpenClaw plugin**. Bring your own answering model and chat transport; the [host integration contract](docs/integration.md) explains the required boundaries.

For optional recognition through reactions and a method for checking conversational quality, see the [participation approach](docs/approach.md). Reaction evaluation and emoji delivery are not implemented in this package.

## Try it

Node.js 22+, MIT, zero runtime dependencies. The offline demo needs no credentials or network access.

```sh
git clone https://github.com/pandore/jev-chat-gate.git
cd jev-chat-gate
npm test
npm run demo
```

To evaluate the same synthetic conversation with the hosted Jev model, set `TYPESAFE_API_KEY` and run `npm run demo -- --live`. This consumes provider quota and never posts chat messages; the model's admission result can differ from the offline fixture.

Install in another project from the GitHub release tag:

```sh
npm install github:pandore/jev-chat-gate#v0.1.1
```

The package is distributed through GitHub release tags and is not published to the npm registry. It is independent of TypeSafe AI; Jev is their hosted model. The MIT license covers this repository's code, not the provider's model or service.

<details>
<summary>Developer integration, API and operational limits</summary>

## Integrate

```js
import { createChatGate, createJevEvaluator } from 'jev-chat-gate';

const scope = 'my-platform:bot-account:community:thread';
const gate = createChatGate({
  scope,
  profile: 'Explain programming concepts with short examples. Do not offer personal advice.',
  stateFile: './.state/community-thread.json',
  evaluate: createJevEvaluator(), // reads TYPESAFE_API_KEY
});

// Called by your host AFTER authorization and transport metadata validation.
async function onMessage(event) {
  const decision = await gate.admit(event);
  if (decision.action !== 'consider') return;

  try {
    // Implement with your model. An admission is not an obligation to reply.
    const answer = (await draftAnswer(event))?.trim();
    if (!answer || answer === 'NO_REPLY') {
      await gate.cancel(decision.token);
      return;
    }
    // Recheck immediately before the one outgoing platform message.
    const permit = await gate.takeSendPermit(decision.token);
    if (!permit.allowed) return;
    const sent = await sendMessage({ scope: permit.scope, replyTo: permit.replyTo, text: answer });
    // Only call after confirmed delivery; use the PLATFORM's returned message ID.
    await gate.recordSent(decision.token, { scope: permit.scope, id: sent.id, text: answer });
  } catch {
    await gate.cancel(decision.token);
    // Report via your host's error handling; never blindly retry an uncertain send.
  }
}
```

`draftAnswer` and `sendMessage` are host functions, not package APIs. Supply your conversation context to the answering model; the gate does not provide it to `draftAnswer`. Keep admitting or observing newer messages while a draft is running: a queue that blocks all ingress until generation ends cannot notice intervening replies. Fail closed on rejected gate calls; do not catch an error and proceed to generation or sending.

If your framework requires every completed turn to produce visible output, configure its ambient completion boundary to allow deliberate silence. Otherwise it can turn `NO_REPLY` into an error placeholder. Preserve required-answer recovery for direct requests. See [silence as a successful completion](docs/integration.md#silence-is-a-successful-completion).

An input event has this explicit contract:

```js
const event = {
  scope: 'my-platform:bot-account:community:thread',
  id: 'platform-message-42',
  authorId: 'platform-user-7',
  authorKind: 'human', // human | bot | unknown | self
  text: 'Can someone explain when a queue is useful?',
  replyTo: null, // platform message ID, or null/omitted
  addressedToAgent: false, // trusted mention / direct-chat routing from your host
  addressedToOther: false, // explicit address to another participant
};
```

Scope must distinguish **platform, bot account, conversation, and thread**. Use one gate and one state file per scope. Do not construct events from model-generated JSON. Self echoes must be marked `self`; an agent name in text is not identity evidence. See the [integration contract](docs/integration.md) for platform mapping and failure handling.

## Decisions

Direct requests and replies to confirmed own messages bypass Jev. Dedupe, mode, and the confirmed-bot budget still apply. Ambient messages use four independent Noul probabilities:

| Signal | Meaning |
| --- | --- |
| `human_exchange` | An unsolicited contribution would intrude on other participants. |
| `already_answered` | The specific question has an adequate answer already. |
| `unresolved_request` | There is an open, unanswered request to the group or assistant. |
| `distinctive_value` | The assistant can contribute something concrete within its capabilities. |

The returned action is `consider` or `ignore`, with a reason. `consider` includes a host-only token; it neither sends a message nor grants tool permissions. Validated ambient results also include the four scores.

Default policy: veto at `0.82`; unresolved requests need `0.75` with veto below `0.60`; distinctive value needs `0.72` with veto below `0.65`. A recent same-person dialogue can use a request threshold of `0.55`, provided human-exchange probability is below `0.65` and the overall veto stays below `0.82`. Another person's reply is not automatically a follow-up.

These are starting values from one community, **not universal calibration**. Override individual values with `thresholds`; exported `DEFAULT_THRESHOLDS` lists all names. Tune the capability `profile` first, then review false interruptions and missed opportunities on consented examples. Do not judge success only by reduced model calls.

## Controls and limits

| API / option | Behavior |
| --- | --- |
| `admit(event)` | Observes and routes one incoming message; duplicates are ignored. |
| `observe(event)` | Adds context and invalidates stale pending output without evaluation. |
| `setMode('normal')` | Direct and ambient participation. |
| `setMode('quiet')` | Direct requests only. |
| `setMode('off')` | No new text participation, including direct requests. |
| `takeSendPermit(token)` | Checks freshness and consumes one send attempt before transport. |
| `recordSent(token, receipt)` | Records only a confirmed delivery for future dialogue context. |
| `cancel(token)` | Abandons an unclaimed run, including when the main model chooses silence. |
| `timeoutMs` | Evaluator deadline, default 8 seconds. |
| `replyTtlMs` | Admission/continuation freshness, default 3 minutes. |
| `botBudget`, `botWindowMs` | Default 2 admitted/pending bot turns per scope per 10 minutes. |
| `redact(text)` option | Replace the default best-effort text filter before storage/evaluation. |

Only trusted host code may change modes. The package does not interpret chat commands or authorize operators. A mode change invalidates outstanding unclaimed permits, including direct requests.

State is a bounded, atomically replaced JSON file: about 40 history messages / 2 hours, 200 runs / 2 hours, 2,000 dedupe and own-message records / 24 hours (plus the current insertion). With no `stateFile`, state is memory-only and lost on restart. A corrupted or mismatched file throws; it is not silently reset. One process and one gate instance must own each file. For shared workers, use transactional storage in your host integration.

For ambient drafts, the final check suppresses observed reply-branch changes and unthreaded same-author continuations. Direct drafts keep their explicit invitation and skip those two checks. All drafts are subject to expiry and policy changes. Invalidations survive history pruning and restart. A claimed send is never automatically retried: a crash between claim and send can lose a reply. This is **not exactly-once delivery** or an atomic fence against a new event arriving after the check. Keep transport calls adjacent to permit consumption.

## Privacy and release scope

The provider receives the capability profile and up to 12 text messages, with transport IDs replaced by local aliases. The default filter masks common URLs, handles, emails, token patterns, code blocks, and long numbers; it cannot reliably remove all sensitive information. Review what your community permits sharing, and replace the filter or evaluator where needed. Local state contains source IDs and filtered message text; keep it private. The library does not log content or credentials.

v0.1.x provides text participation, dialogue continuity, deterministic controls, a Jev HTTP adapter, and an offline demo. It does not include channel SDKs, a stock OpenClaw plugin, model prompting orchestration, message batching, automatic roles, or emoji delivery. The broader [participation approach](docs/approach.md) explains how those fit without making them dependencies of the core, including a reusable reaction rubric that distinguishes a required answer from a merely possible comment and a paired evaluation procedure. The [integration contract](docs/integration.md#silence-is-a-successful-completion) also covers native completion policies so intentional silence does not become an error message.

This is an extracted reference implementation. The tests cover routing/lifecycle invariants and a stubbed HTTP contract, not real-world conversational quality or platform end-to-end delivery. The live Jev demo is opt-in. Validate your own adapter with platform receipts before enabling ambient replies.

Protocol references: [TypeSafe API](https://docs.typesafe.ai/api), [Noul semantics](https://docs.typesafe.ai/primitives/noul). No provider code or model weights are bundled; provider access remains subject to its terms.

</details>

## Contributing

Use a focused pull request with a runnable regression example for behavioral changes. Run `npm test` and `npm run demo`; there is no build step. Use synthetic conversations only. Never submit credentials, raw community exports, or deployment state in an issue or PR. MIT covers the code in this repository; see [LICENSE](LICENSE).
