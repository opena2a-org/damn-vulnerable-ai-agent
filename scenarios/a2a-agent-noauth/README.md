# A2A Agent Without Authentication

**Check:** A2A-001, A2A-002 | **Severity:** High | **Auto-Fix:** No (manual)

An A2A agent with a publicly discoverable agent.json and task submission endpoints (/tasks/send, /tasks/get) without any authentication. Anyone can submit tasks to the agent.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Add authentication requirements to agent.json and require API key/bearer token for task endpoints.
