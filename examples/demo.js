import assert from 'node:assert/strict';
import { createChatGate, createJevEvaluator } from '../src/index.js';

// Fully synthetic. Offline by default; --live sends ONLY these examples to TypeSafe.
const live = process.argv.includes('--live');
const scores = { human_exchange: 0.1, already_answered: 0.1, unresolved_request: 0.9, distinctive_value: 0.8 };
const scope = 'demo:account:community:thread';
const gate = createChatGate({ scope, profile: 'Explain programming concepts with short, concrete examples.',
  evaluate: live ? createJevEvaluator() : async () => scores });
const event = (id, text, extra = {}) => ({ scope, id, text, authorId: 'person-a', authorKind: 'human',
  addressedToAgent: false, addressedToOther: false, ...extra });

const first = await gate.admit(event('question-1', 'When should I use a queue instead of a direct function call?'));
console.log('Group question:', first.action, first.reason);
if (!live) assert.equal(first.action, 'consider');
if (first.action === 'consider') {
  // Your primary model would draft here; this demo has no model or chat transport.
  await gate.observe(event('reply-1', 'A queue helps decouple work and absorb bursts.', {
    authorId: 'person-b', replyTo: 'question-1', addressedToOther: true,
  }));
  const permit = await gate.takeSendPermit(first.token);
  assert.equal(permit.allowed, false);
  console.log('Another person replied while drafting:', permit.reason);
}

await gate.setMode('quiet');
const direct = await gate.admit(event('question-2', 'Assistant, explain retry backoff.', { addressedToAgent: true }));
assert.equal(direct.action, 'consider');
const permit = await gate.takeSendPermit(direct.token);
assert.equal(permit.allowed, true);
console.log('Direct request in quiet mode:', direct.reason);
// A real host calls recordSent only after a successful platform receipt.
console.log('Demo finished. No messages sent to any chat.');
