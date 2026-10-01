# Working with Jev Chat Gate

This repository is a JavaScript participation library, not a ready-made agent
plugin. It adds useful contributions without a tag to an agent's existing direct
request behavior. The answering model still writes the reply and may stay silent.

If the owner asks you to install or integrate it into their agent:

1. Read [the agent installation guide](docs/agent-install.md).
2. Read [the host integration contract](docs/integration.md) before changing the
   host's message processing or delivery.
3. Inspect the actual installed runtime and its native integration points. Do not
   assume OpenClaw, Hermes, or another Telegram agent is already supported.
4. Preserve the host's access controls, direct-request behavior, and unrelated
   configuration. A gate decision never grants permission to use tools or act.
5. Distinguish a package installation, a working adapter, and verified delivery.
   If a required runtime capability is missing, report the specific blocker.

For changes to this library, use a focused pull request and synthetic examples.
Read the affected source and existing tests; run `npm test` and `npm run demo`.
Keep credentials, community transcripts, and host state out of this repository.
Do not add a framework adapter or optional feature unless it serves the owner's
request. Reaction delivery is outside the current package.
