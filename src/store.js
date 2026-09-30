import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

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
      value.runs.every(row => typeof row.token === 'string' && typeof row.inputId === 'string' &&
        typeof row.config === 'string' && Array.isArray(row.branchIds) && Array.isArray(row.observedIds) &&
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
      state.runs = state.runs.filter(x => now - x.ts < 7200000).slice(-200);
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
