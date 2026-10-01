import { createHash, randomUUID } from 'node:crypto';
import { Store, RUN_LIMIT, pendingRun } from './store.js';
import { DEFAULT_THRESHOLDS, redact, middleTrim, evaluationRequest, followupCandidate, replyChain, route, validateScores } from './policy.js';
export { createJevEvaluator } from './jev.js';
export { DEFAULT_THRESHOLDS, redact, route } from './policy.js';

const textId = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
const ignore = reason => ({ action: 'ignore', reason });
const denied = reason => ({ allowed: false, reason });

/** One gate per provider/account/conversation/thread. Metadata must come from the host. */
export function createChatGate({ scope, profile, evaluate, stateFile, thresholds = {},
  redact: filter = redact, clock = Date.now, timeoutMs = 8000, replyTtlMs = 180000,
  botBudget = 2, botWindowMs = 600000 } = {}) {
  if (!textId(scope) || typeof profile !== 'string' || !profile.trim() || profile.length > 1500 ||
      typeof evaluate !== 'function' || typeof filter !== 'function' || typeof clock !== 'function' ||
      (stateFile !== undefined && (typeof stateFile !== 'string' || !stateFile))) throw new Error('invalid_configuration');
  for (const n of [timeoutMs, replyTtlMs, botWindowMs]) {
    if (!Number.isSafeInteger(n) || n < 1 || n > 7200000) throw new Error('invalid_duration');
  }
  if (!Number.isSafeInteger(botBudget) || botBudget < 0 || botBudget > 100) throw new Error('invalid_bot_budget');
  if (!thresholds || typeof thresholds !== 'object' || Array.isArray(thresholds) ||
      Object.keys(thresholds).some(key => !Object.hasOwn(DEFAULT_THRESHOLDS, key))) throw new Error('invalid_thresholds');
  const tuning = { ...DEFAULT_THRESHOLDS, ...thresholds };
  if (Object.values(tuning).some(n => !Number.isFinite(n) || n < 0 || n > 1)) throw new Error('invalid_thresholds');
  const config = createHash('sha256').update(JSON.stringify({ profile, tuning, replyTtlMs, botBudget, botWindowMs })).digest('hex');
  const store = new Store(stateFile, scope, clock);

  function normalize(event) {
    if (event?.scope !== scope || !textId(event.id) || !textId(event.authorId) ||
        !['human', 'bot', 'unknown', 'self'].includes(event.authorKind) ||
        typeof event.addressedToAgent !== 'boolean' || typeof event.addressedToOther !== 'boolean' ||
        typeof event.text !== 'string' || event.text.length > 100000 ||
        (event.edited !== undefined && typeof event.edited !== 'boolean') ||
        (event.timestampMs !== undefined && (!Number.isSafeInteger(event.timestampMs) || event.timestampMs < 0)) ||
        (event.replyTo !== undefined && event.replyTo !== null && !textId(event.replyTo))) throw new Error('invalid_event');
    const safe = filter(event.text);
    if (typeof safe !== 'string') throw new Error('invalid_redactor_result');
    return { id: event.id, authorId: event.authorId, authorKind: event.authorKind,
      addressedToAgent: event.addressedToAgent, addressedToOther: event.addressedToOther,
      replyTo: event.replyTo || null, text: middleTrim(safe, 1600), ts: event.timestampMs,
      edited: event.edited === true };
  }

  function observeRow(s, input, now) {
    if (input.ts > now) throw new Error('future_timestamp');
    const previous = s.history.find(x => x.id === input.id);
    const own = input.edited ? s.own.find(x => x.id === input.id) : null;
    if (own && input.authorKind !== 'self') throw new Error('edit_identity_mismatch');
    if (input.edited && s.runs.some(x => x.inputId === input.id && x.authorId !== input.authorId))
      throw new Error('edit_identity_mismatch');
    if (input.edited && previous && (previous.authorKind !== input.authorKind ||
        (previous.authorKind !== 'self' && previous.authorId !== input.authorId))) throw new Error('edit_identity_mismatch');
    if (previous && !input.confirmed && !input.edited) return previous;
    const { edited, ...data } = input;
    // Original source metadata can predate an observation or late-receipt fallback; edits never refresh it.
    const row = { ...data, ts: Math.min(previous?.ts ?? own?.messageTs ?? own?.ts ?? now, input.ts ?? now),
      ...(previous?.confirmed || own ? { confirmed: true, authorId: previous?.authorId ?? 'self' } : {}) };
    if (own) own.messageTs = row.ts;
    if (previous) s.history[s.history.indexOf(previous)] = row;
    else s.history.push(row);
    for (const run of s.runs) {
      if (run.invalidated || !['evaluating', 'admitted'].includes(run.status)) continue;
      if (edited && (run.branchIds.includes(row.id) || (!run.direct && run.observedIds.includes(row.id)))) {
        run.invalidated = 'message_edited'; continue;
      }
      if (run.direct || (run.observedIds.includes(row.id) && !input.confirmed)) continue;
      // Latch invalidation now: bounded history can evict its evidence before delivery.
      if (row.replyTo && (run.branchIds.includes(row.replyTo) ||
          [...replyChain(s.history, row)].some(id => run.branchIds.includes(id)))) run.invalidated = 'reply_branch_changed';
      else if (!row.replyTo && row.authorKind !== 'self' && row.authorId === run.authorId)
        run.invalidated = 'same_speaker_continuation';
    }
    return row;
  }

  function blocked(s, run, now) {
    if (run.config !== config || run.revision !== s.revision) return 'policy_changed';
    if (s.mode === 'off' || (!run.direct && s.mode === 'quiet')) return 'participation_disabled';
    if (now < run.ts || now - run.ts >= replyTtlMs) return 'expired';
    return run.invalidated || null;
  }

  async function admit(event) {
    const input = normalize(event);
    const prepared = await store.transact((s, now) => {
      // Legacy drafts lack a lease. Matching config proves their original TTL;
      // mismatched policy cannot authorize a send and must not occupy capacity.
      for (const run of s.runs) if (run.status === 'admitted' && run.expiresAt === undefined)
        run.expiresAt = run.ts + (run.config === config ? replyTtlMs : 0);
      if (input.ts !== undefined && (now < input.ts || (!input.edited && now - input.ts >= replyTtlMs)))
        return { decision: ignore('expired_inbound') };
      const row = observeRow(s, input, now);
      if (input.edited) {
        if (!s.seen.some(x => x.id === row.id)) s.seen.push({ id: row.id, ts: now });
        return { decision: ignore('message_edited') };
      }
      if (s.seen.some(x => x.id === row.id)) return { decision: ignore('duplicate') };
      s.seen.push({ id: row.id, ts: now });
      if (row.authorKind === 'self' || s.own.some(x => x.id === row.id)) return { decision: ignore('self_message') };
      if (now < row.ts || now - row.ts >= replyTtlMs) return { decision: ignore('expired_inbound') };
      if (s.mode === 'off') return { decision: ignore('participation_disabled') };
      s.botTurns = s.botTurns.filter(x => now - x.ts < botWindowMs);
      if (row.authorKind === 'bot' && s.botTurns.length >= botBudget) return { decision: ignore('bot_budget') };
      const direct = row.addressedToAgent || s.own.some(x => x.id === row.replyTo);
      if (!direct && row.addressedToOther) return { decision: ignore('addressed_to_other') };
      if (!direct && s.mode === 'quiet') return { decision: ignore('quiet_mode') };
      if (s.runs.filter(x => pendingRun(x, now)).length >= RUN_LIMIT) return { decision: ignore('run_capacity') };
      const token = randomUUID();
      const run = { token, inputId: row.id, authorId: row.authorId, ts: row.ts, expiresAt: row.ts + replyTtlMs, config, revision: s.revision,
        direct, status: direct ? 'admitted' : 'evaluating', observedIds: s.history.map(x => x.id),
        branchIds: [...replyChain(s.history, row)] };
      s.runs.push(run);
      // Reservations count before evaluation, including direct mentions by other bots.
      if (row.authorKind === 'bot') s.botTurns.push({ token, ts: now });
      if (direct) return { decision: { action: 'consider', reason: 'direct', token } };
      const followup = followupCandidate(s.history, row, now, replyTtlMs);
      return { token, followup, request: evaluationRequest(s.history, row, followup, profile) };
    });
    if (prepared.decision) return prepared.decision;
    let decision, scores;
    const controller = new AbortController();
    let timer;
    try {
      // Also bound custom evaluators that accidentally ignore AbortSignal.
      const result = await Promise.race([
        Promise.resolve().then(() => evaluate(prepared.request, { signal: controller.signal })),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs); }),
      ]);
      scores = validateScores(result);
      decision = route(scores, prepared.followup, tuning);
    } catch { decision = ignore('evaluation_failed'); }
    finally { clearTimeout(timer); }
    return store.transact((s, now) => {
      const run = s.runs.find(x => x.token === prepared.token);
      if (!run || run.status !== 'evaluating') return ignore('run_unavailable');
      const reason = blocked(s, run, now);
      if (reason) decision = ignore(reason);
      run.status = decision.action === 'consider' ? 'admitted' : 'ignored';
      run.reason = decision.reason;
      // Failures/unknown outcomes retain their bot reservation until the window expires.
      if (decision.action === 'ignore' && decision.reason !== 'evaluation_failed')
        s.botTurns = s.botTurns.filter(x => x.token !== run.token);
      return { ...decision, ...(decision.action === 'consider' ? { token: run.token } : {}), ...(scores ? { scores } : {}) };
    });
  }

  return {
    admit,
    async observe(event) {
      const row = normalize(event);
      await store.transact((s, now) => { observeRow(s, row, now); });
    },
    async setMode(mode) {
      if (!['normal', 'quiet', 'off'].includes(mode)) throw new Error('invalid_mode');
      return store.transact(s => {
        if (s.mode !== mode) { s.mode = mode; s.revision++; }
        return { mode: s.mode, revision: s.revision };
      });
    },
    async takeSendPermit(token) {
      return store.transact((s, now) => {
        const run = s.runs.find(x => x.token === token);
        if (!run || run.status !== 'admitted') return denied('run_unavailable_or_consumed');
        const reason = blocked(s, run, now);
        if (reason) { run.status = 'cancelled'; return denied(reason); }
        run.status = 'claimed'; // Persist BEFORE transport; unknown outcomes are never retried here.
        return { allowed: true, scope, replyTo: run.inputId };
      });
    },
    async recordSent(token, receipt) {
      if (receipt?.scope !== scope || !textId(receipt.id) || typeof receipt.text !== 'string' || receipt.text.length > 100000)
        throw new Error('invalid_receipt');
      const safe = filter(receipt.text);
      if (typeof safe !== 'string') throw new Error('invalid_redactor_result');
      return store.transact((s, now) => {
        const run = s.runs.find(x => x.token === token);
        if (run?.status === 'sent' && run.sentId === receipt.id) return { recorded: true };
        if (!run || run.status !== 'claimed') throw new Error('receipt_without_send_permit');
        if (s.history.some(x => x.id === receipt.id && x.authorKind !== 'self') || s.own.some(x => x.id === receipt.id))
          throw new Error('receipt_id_conflict');
        run.status = 'sent'; run.sentId = receipt.id;
        s.seen.push({ id: receipt.id, ts: now });
        const row = observeRow(s, { id: receipt.id, authorId: 'self', authorKind: 'self', confirmed: true, text: middleTrim(safe, 1600),
          replyTo: run.inputId, addressedToAgent: false, addressedToOther: false }, now);
        s.own.push({ id: receipt.id, ts: now, messageTs: row.ts });
        return { recorded: true };
      });
    },
    async cancel(token) {
      return store.transact(s => {
        const run = s.runs.find(x => x.token === token);
        if (!run || !['admitted', 'evaluating'].includes(run.status)) return { cancelled: false };
        run.status = 'cancelled'; return { cancelled: true };
      });
    },
  };
}
