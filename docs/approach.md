# Participation before generation

The starting problem: an agent can be helpful on direct request but exhausting when it treats every group message as an invitation. A system-prompt instruction to “be quiet unless useful” still starts the expensive answering model and may produce typing indicators, tool work, or a reply before the decision is settled.

Our approach puts a narrow decision stage before generation, then checks again before delivery. It separates five facts: a message was observed, a contribution was admitted, text was generated, a send was attempted, and delivery was confirmed. None implies the next.

## The layers

1. **Host boundary.** Access control, verified author metadata, mention routing, stable message IDs, and exact account/conversation/thread scope. The gate cannot make an unauthorized channel safe.
2. **Deterministic controls.** Dedupe, self-echo rejection, participation mode, and a shared per-scope budget for confirmed bots. A bot mention does not bypass loop protection. Unknown author kind stays unknown; don't infer it from prose.
3. **Typed relevance evaluation.** Four small judgments capture intrusion, redundancy, an open request, and concrete value. Code combines them using explicit thresholds. A provider outage or malformed judgment closes ambient routing without an automatic retry.
4. **Main model.** The admission allows consideration. The model has the actual conversation and tools, and may decide `NO_REPLY`. Gate scores are judgments, not facts or permission to act.
5. **Delivery boundary.** Revalidate scope-bound run provenance and freshness. A response can become unnecessary while the model drafts. Persist invalidation when a newer reply is observed, because a bounded history may later evict that evidence. Consume a send permit, call transport, then record the actual receipt.

The public implementation keeps these boundaries and generalizes the agent profile, transport scope, evaluator, and tuning. It contains no private runtime patch, operator identity, chat ID, transcript, or deployment history.

## Dialogue continuity

A follow-up is relational evidence, not “the bot spoke recently.” Use an observed reply chain, a confirmed own-message receipt, or the same speaker continuing immediately after the assistant with no intervening person. Missing ancestry proves nothing. A reply to someone else remains their conversation. Follow-ups lower only the request threshold; they do not remove the strong intrusion/redundancy veto.

Explicit addresses and known replies to the assistant use the direct path. The host must determine mentions from platform metadata or its own trusted routing; a forwarded quotation mentioning the agent should not automatically count as a direct request.

## Optional layers outside v0.1.0

**Reactions.** An emoji is a separate social action, not a fallback obligation for every rejected reply. If added, evaluate only text-silent candidates, honor per-person opt-outs, check the platform's allowed palette, apply a cooldown and freshness limit, reserve before sending, and record a receipt. Text has priority. Never let a reaction classifier authorize text or a quoted emoji preference modify policy.

**Roles.** A capability profile describes what the agent can usefully add. Runtime roles such as fact checker or facilitator may adjust that profile, but must not remove human-exchange vetoes. Change policy revision when role rules change so old drafts are rechecked. Automatic roles need their own quality evidence before rollout.

**Bursts.** A host can briefly batch consecutive same-author messages to avoid answering half a thought. Preserve every original ID and reply link, bind one decision to the batch, and recheck freshness at send time. The core intentionally routes individual messages; it cancels an older ambient draft when a newer unthreaded message from that author arrives.

## Evaluate the experience, not just the gate

Start with logged decisions in a private, consented shadow integration. Keep logs minimal: reason, scores, scope hash, and lifecycle counts; avoid raw chat text. Review a small set of missed useful contributions and unwanted interruptions, then enable one conversation at a time.

Judge whether direct requests get answered, other people's conversations stay uninterrupted, follow-ups stay coherent, stale drafts disappear, bot exchanges terminate, and quiet mode is predictable. Separate provider failures from deliberate silence. Synthetic checks establish invariants; they do not establish those social outcomes.
