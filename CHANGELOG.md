# Changelog

## 0.1.2 — 2026-10-01

- Accept trusted `edited: true` events to update observed context and invalidate affected unclaimed drafts, including direct source edits. Edits never start a new evaluation or send automatically.
- Accept optional original-message `timestampMs` in Unix milliseconds. Reject stale/future admissions and measure draft expiry from the source time; hosts without this field retain observed-time behavior.
- Preserve pending evaluations, unexpired drafts, and claimed sends during bounded run pruning. Return `run_capacity` at 200 pending runs; cancelled, settled, and expired drafts free capacity. Claimed sends remain protected within the two-hour retention window.
- Add regression checks for edits, trusted identity, source freshness, capacity, late receipts, and restart behavior. Record behavior-changing proposals in the [backlog](docs/backlog.md).

Thresholds, redaction, normal/quiet/off modes, and bot budgets are unchanged. These are core reliability checks with synthetic data, not new platform adapters or evidence of conversational quality. Existing version-1 state files remain readable.

## 0.1.1 — 2026-10-01

- Document a reusable optional reaction rubric: recognize personal effort without mistaking a possible comment for a required text answer; retain fit, risk and delivery checks.
- Clarify successful intentional silence at the host's completion boundary, including checks after runtime upgrades.
- Add a paired evaluation procedure with frozen context, explicit label provenance and limits on quality claims.

Documentation update; the text-gate API, behavior and thresholds are unchanged. Examples are synthetic; no private chat data or host configuration is included.

## 0.1.0

First public extraction: framework-independent participation gate, four-signal Jev evaluation, direct-address bypass, observed dialogue continuity, scope isolation, deterministic modes, confirmed-bot budget, persistent dedupe, durable freshness invalidation, and one-use send permits.

Includes a dependency-free TypeSafe HTTP adapter, offline synthetic demo, focused lifecycle tests, and host integration documentation. Channel transports and runtime-specific plugins are not included.
