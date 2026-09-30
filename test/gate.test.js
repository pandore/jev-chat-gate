import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatGate, createJevEvaluator, DEFAULT_THRESHOLDS, route } from '../src/index.js';

const scope = 'test:account:room:thread';
const yes = { human_exchange: 0.1, already_answered: 0.1, unresolved_request: 0.9, distinctive_value: 0.8 };
const no = { human_exchange: 0.1, already_answered: 0.1, unresolved_request: 0.1, distinctive_value: 0.1 };
const event = (id, extra = {}) => ({ scope, id, text: 'How does this work?', authorId: 'a', authorKind: 'human',
  addressedToAgent: false, addressedToOther: false, ...extra });
const gate = extra => createChatGate({ scope, profile: 'Explain programming concepts.', evaluate: async () => yes, ...extra });
async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'jev-gate-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'state.json');
}

test('direct requests bypass evaluator; quiet keeps direct, off blocks all', async () => {
  let calls = 0;
  const g = gate({ evaluate: async () => { calls++; return yes; } });
  await g.setMode('quiet');
  assert.equal((await g.admit(event('ambient'))).reason, 'quiet_mode');
  const direct = await g.admit(event('direct', { addressedToAgent: true }));
  assert.equal(direct.reason, 'direct');
  assert.equal(calls, 0);
  await g.setMode('off');
  assert.equal((await g.takeSendPermit(direct.token)).allowed, false);
  assert.equal((await g.admit(event('off', { addressedToAgent: true }))).action, 'ignore');
});

test('rubric vetoes intrusion; follow-ups relax only the request threshold', () => {
  assert.equal(route({ ...yes, human_exchange: 0.9 }, true).action, 'ignore');
  assert.equal(route({ ...no, unresolved_request: 0.6 }, true).reason, 'dialogue_followup');
  assert.equal(route({ ...no, unresolved_request: 0.6 }).action, 'ignore');
  assert.equal(route({ ...yes, already_answered: DEFAULT_THRESHOLDS.veto }, true).action, 'ignore');
  assert.throws(() => route({ ...yes, human_exchange: NaN }), /invalid_scores/);
});

test('successful receipts support unmentioned follow-ups and direct reply detection', async () => {
  let request;
  const g = gate({ evaluate: async r => { request = r; return { ...no, unresolved_request: 0.6 }; } });
  const direct = await g.admit(event('q', { addressedToAgent: true }));
  await g.takeSendPermit(direct.token);
  await g.recordSent(direct.token, { scope, id: 'answer', text: 'An explanation.' });
  const followup = await g.admit(event('more', { text: 'Can you give an example?' }));
  assert.equal(followup.reason, 'dialogue_followup');
  assert.match(request.state, /Recent dialogue candidate: true/);
  assert.equal((await g.admit(event('reply', { replyTo: 'answer' }))).reason, 'direct');
  const other = await g.admit(event('human-reply', { replyTo: 'q', authorId: 'b' }));
  assert.equal(other.action, 'ignore');
  assert.match(request.state, /Recent dialogue candidate: false/);
});

test('invalidation during evaluation survives history eviction and process restart', async t => {
  const stateFile = await temp(t);
  let resolve, started;
  const ready = new Promise(r => { started = r; });
  const g = gate({ stateFile, evaluate: () => new Promise(r => { resolve = r; started(); }) });
  const pending = g.admit(event('q'));
  await ready;
  await g.observe(event('human-answer', { authorId: 'b', replyTo: 'q' }));
  for (let i = 0; i < 45; i++) await g.observe(event(`noise-${i}`, { authorId: 'c' }));
  resolve(yes);
  assert.equal((await pending).reason, 'reply_branch_changed');
  const disk = JSON.parse(await readFile(stateFile, 'utf8'));
  assert.equal(disk.history.some(x => x.id === 'human-answer'), false);
  const restarted = gate({ stateFile });
  assert.equal((await restarted.admit(event('q'))).reason, 'duplicate');
});

test('branch invalidation after admission survives eviction and restart', async t => {
  const stateFile = await temp(t), g = gate({ stateFile });
  const decision = await g.admit(event('q'));
  // Even if the original question is no longer in history, its saved branch matters.
  for (let i = 0; i < 45; i++) await g.observe(event(`before-${i}`, { authorId: 'c' }));
  await g.observe(event('answer', { authorId: 'b', replyTo: 'q' }));
  for (let i = 0; i < 45; i++) await g.observe(event(`after-${i}`, { authorId: 'c' }));
  assert.equal((await gate({ stateFile }).takeSendPermit(decision.token)).reason, 'reply_branch_changed');
});

test('permits are consumed before sending and cannot be retried after restart', async t => {
  const stateFile = await temp(t), g = gate({ stateFile });
  const decision = await g.admit(event('q'));
  const permits = await Promise.all([g.takeSendPermit(decision.token), g.takeSendPermit(decision.token)]);
  assert.equal(permits.filter(x => x.allowed).length, 1);
  const restarted = gate({ stateFile });
  assert.equal((await restarted.takeSendPermit(decision.token)).allowed, false);
  await restarted.recordSent(decision.token, { scope, id: 'answer', text: 'It works.' });
  assert.equal((await restarted.recordSent(decision.token, { scope, id: 'answer', text: 'It works.' })).recorded, true);
  assert.equal((await restarted.admit(event('q'))).reason, 'duplicate');
});

test('same-speaker continuation, policy change, configuration change and expiry stop stale output', async t => {
  let now = 10000;
  const stateFile = await temp(t), g = gate({ stateFile, clock: () => now });
  const first = await g.admit(event('first'));
  await g.observe(event('continuation'));
  assert.equal((await g.takeSendPermit(first.token)).reason, 'same_speaker_continuation');
  const second = await g.admit(event('second'));
  assert.equal((await gate({ stateFile, clock: () => now, profile: 'Different capabilities.' }).takeSendPermit(second.token)).reason, 'policy_changed');
  // Separate owner after restart, never concurrent instances writing the same file.
  const resumed = gate({ stateFile, clock: () => now });
  const third = await resumed.admit(event('third'));
  now += 180000;
  assert.equal((await resumed.takeSendPermit(third.token)).reason, 'expired');
});

test('confirmed bot budget applies before direct bypass and counts pending evaluations', async () => {
  let resolve, started;
  const ready = new Promise(r => { started = r; });
  const g = gate({ botBudget: 1, evaluate: () => new Promise(r => { resolve = r; started(); }) });
  const pending = g.admit(event('b1', { authorKind: 'bot' }));
  await ready;
  assert.equal((await g.admit(event('b2', { authorId: 'another-bot', authorKind: 'bot', addressedToAgent: true }))).reason, 'bot_budget');
  resolve(yes); await pending;
  assert.equal((await g.admit(event('human', { addressedToAgent: true }))).reason, 'direct');
});

test('timeouts and malformed evaluations close ambient routing without exposing error text', async () => {
  const slow = gate({ timeoutMs: 10, evaluate: () => new Promise(() => {}) });
  assert.equal((await slow.admit(event('slow'))).reason, 'evaluation_failed');
  for (const evaluate of [async () => { throw new Error('private upstream detail'); }, async () => ({ human_exchange: 'bad' })]) {
    const result = await gate({ evaluate }).admit(event('bad'));
    assert.deepEqual(result, { action: 'ignore', reason: 'evaluation_failed' });
  }
});

test('trust boundaries reject wrong scopes, missing metadata, invented receipts and corrupt state', async t => {
  const g = gate();
  await assert.rejects(g.admit(event('wrong', { scope: 'other' })), /invalid_event/);
  await assert.rejects(g.admit(event('missing', { addressedToAgent: undefined })), /invalid_event/);
  await assert.rejects(g.recordSent('invented', { scope, id: 'out', text: 'Hi' }), /receipt_without_send_permit/);
  assert.equal((await g.takeSendPermit('invented')).allowed, false);
  const stateFile = await temp(t);
  await writeFile(stateFile, '{broken');
  await assert.rejects(gate({ stateFile }).admit(event('q')), /state_unreadable/);
  await writeFile(stateFile, '{}');
  await assert.rejects(gate({ stateFile }).admit(event('q')), /state_invalid_or_wrong_scope/);
});

test('bounded provider context masks common secrets and aliases transport identities', async () => {
  let captured;
  const g = gate({ evaluate: async req => { captured = req; return yes; } });
  await g.observe(event('previous-id', { authorId: 'private-author', text: 'email@example.test https://example.test password=secret-value' }));
  await g.admit(event('current-id', { replyTo: 'previous-id', text: 'A'.repeat(9000) + ' How do queues work?' }));
  assert.ok(captured.state.length <= 12000);
  for (const value of ['private-author', 'previous-id', 'current-id', 'secret-value', 'email@example.test', scope])
    assert.equal(captured.state.includes(value), false);
  assert.match(captured.state, /How do queues work/);
});

test('Jev HTTP adapter matches typed contract, validates answers and never retries', async () => {
  let calls = 0;
  const evaluate = createJevEvaluator({ apiKey: 'synthetic-test-key', fetch: async (url, init) => {
    calls++; assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(init.redirect, 'error');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'jev-latest');
    assert.equal(Object.keys(body.questions).length, 4);
    return { ok: true, json: async () => ({ answers: Object.fromEntries(Object.entries(yes).map(([k, noul]) => [k, { type: 'noul', noul }])) }) };
  } });
  assert.equal((await gate({ evaluate }).admit(event('q'))).action, 'consider');
  assert.equal(calls, 1);
  calls = 0;
  const failing = createJevEvaluator({ apiKey: 'synthetic-test-key', fetch: async () => { calls++; return { ok: false, status: 429 }; } });
  assert.equal((await gate({ evaluate: failing }).admit(event('q'))).reason, 'evaluation_failed');
  assert.equal(calls, 1);
});
