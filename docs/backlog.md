# Backlog

These proposals are not implemented or promised release features. Prefer a small,
measured change over adding every possible participation control.

The v0.1.2 reliability work covers edit invalidation, optional source timestamps,
and protection of pending runs and delivery receipts. The items below need more
evidence, a host adapter, or additional scope before implementation.

| Proposal | What needs to be established first |
| --- | --- |
| Ambient frequency limits, cooldowns, or daily caps | Review real bursts, missed open requests, and useful untagged follow-ups. Compare configurable window limits before choosing defaults; account for pending work and uncertain sends, and preserve direct-request controls. A fixed pause after every contribution can suppress useful dialogue. |
| Link-aware redaction | Show that limited link-type hints improve decisions on labeled examples. Keep private hosts, identifiers, paths, and credentials out of provider context; retain the current default filter until an opt-in policy is validated. |
| Built-in shadow simulation | Start with a host example using current decisions and scores without delivery. If quota simulation is needed, keep simulated state and outcomes separate from real receipts; a gate admission does not mean the main model would have answered. |
| Threshold or rubric changes | Compare identical frozen contexts with independent labels and a held-out sample. Distinguish required answers, acceptable optional comments, reactions, silence, and uncertainty. Threshold-boundary tests alone cannot establish usefulness. |
| Automatic reevaluation after edits | Define revision ordering, debounce, direct-request recovery, and one-send semantics in the adapter. The core currently cancels affected drafts; it does not restart them. |
| Deletes and out-of-order reconciliation | Establish trusted platform event ordering and how updates invalidate context and run bindings. Adapters currently deliver authorized events in source order. |
| Retrieval of older conversation fragments | Demonstrate missed already-answered cases, then verify scope isolation, relevance, minimization, and bounded provider context. |
| Multi-writer state protection | The JSON store requires one owner. If a host needs shared workers, integrate transactional storage rather than assume an atomic file replacement is a distributed lock. |
| Reactions and automatic roles | Keep separate evaluation, permissions, budgets, and delivery receipts. Validate social fit and text priority through a host adapter before adding them to the public package. |

Use synthetic, minimized examples in public issues and pull requests. Community
transcripts, private labels, credentials, and deployment state stay outside this
repository. See the [evaluation approach](approach.md#evaluate-the-experience-not-just-the-gate).
