import { validateScores } from './policy.js';

/** Returns an evaluator compatible with createChatGate. Never retries requests. */
export function createJevEvaluator({ apiKey = process.env.TYPESAFE_API_KEY, model = 'jev-latest', fetch: request = globalThis.fetch } = {}) {
  if (typeof apiKey !== 'string' || !apiKey || /\s/.test(apiKey)) throw new Error('invalid_api_key');
  if (typeof model !== 'string' || !model || model.length > 100) throw new Error('invalid_model');
  const evaluate = async ({ state, questions }, { signal } = {}) => {
    if (typeof state !== 'string' || !state || state.length > 12000) throw new Error('invalid_state');
    let response;
    try {
      response = await request('https://api.typesafe.ai/v1/systemone', {
        method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, state, questions }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
      });
    } catch { throw new Error('jev_request_failed_or_timed_out'); }
    if (!response.ok) throw new Error(`jev_http_${response.status}`);
    let result;
    try { result = await response.json(); } catch { throw new Error('jev_invalid_json'); }
    const scores = {};
    for (const name of Object.keys(questions)) {
      const answer = result?.answers?.[name];
      if (answer?.type !== 'noul') throw new Error('jev_invalid_answer');
      scores[name] = answer.noul;
    }
    return validateScores(scores);
  };
  return evaluate;
}
