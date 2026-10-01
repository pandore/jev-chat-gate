import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const RUN_LIMIT = 200;
export const pendingRun = (run, now) => ['evaluating', 'claimed'].includes(run.status) ||
  (run.status === 'admitted' && (run.expiresAt === undefined || now < run.expiresAt));

export class Store {
  constructor(file, scope, clock) {
    this.file = file; this.scope = scope; this.clock = clock; this.queue = Promise.resolve();
  }
  async load() {
    if (!this.file) return this.empty();
    let value;
    try { value = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return this.empty();
      throw new Error('state_unreadable');
    }
    const valid = value?.version === 1 && value.scope === this.scope &&
      ['normal', 'quiet', 'off'].includes(value.mode) && Number.isSafeInteger(value.revision) &&
      ['history', 'seen', 'own', 'runs', 'botTurns'].every(key => Array.isArray(value[key]) &&
        value[key].every(row => row && Number.isFinite(row.ts))) &&
      value.history.every(row => typeof row.id === 'string' && typeof row.authorId === 'string' &&
        ['human', 'bot', 'unknown', 'self'].includes(row.authorKind) && typeof row.text === 'string') &&
      value.own.every(row => row.messageTs === undefined || (Number.isFinite(row.messageTs) && row.messageTs >= 0)) &&
      value.runs.every(row => typeof row.token === 'string' && typeof row.inputId === 'string' &&
        typeof row.config === 'string' && Array.isArray(row.branchIds) && Array.isArray(row.observedIds) &&
        (row.expiresAt === undefined || (Number.isFinite(row.expiresAt) && row.expiresAt >= row.ts)) &&
        ['evaluating', 'admitted', 'ignored', 'claimed', 'sent', 'cancelled'].includes(row.status));
    if (!valid) throw new Error('state_invalid_or_wrong_scope');
    return value;
  }
  empty() {
    return { version: 1, scope: this.scope, mode: 'normal', revision: 0,
      history: [], seen: [], own: [], runs: [], botTurns: [] };
  }
  transact(fn) {
    const work = this.queue.then(async () => {
      const state = structuredClone(this.state ?? await this.load()), now = this.clock();
      if (!Number.isFinite(now) || now < 0) throw new Error('invalid_clock');
      state.history = state.history.filter(x => now - x.ts < 7200000).slice(-40);
      const retained = state.runs.filter(x => now - x.ts < 7200000);
      const pending = retained.filter(x => pendingRun(x, now));
      const settled = retained.filter(x => !pendingRun(x, now));
      // Keep in-flight work and uncertain sends; admission enforces the pending limit.
      state.runs = [...settled.slice(Math.max(0, settled.length - Math.max(0, RUN_LIMIT - pending.length))), ...pending];
      for (const key of ['seen', 'own']) state[key] = state[key].filter(x => now - x.ts < 86400000).slice(-2000);
      const result = fn(state, now);
      if (this.file) {
        await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
        const temp = `${this.file}.${randomUUID()}.tmp`;
        await writeFile(temp, JSON.stringify(state) + '\n', { mode: 0o600, flag: 'wx' });
        await rename(temp, this.file);
      }
      this.state = state;
      return structuredClone(result);
    });
    // ponytail: one queue and one owner per file; use a transactional DB for multiple workers.
    this.queue = work.catch(() => {});
    return work;
  }
}
