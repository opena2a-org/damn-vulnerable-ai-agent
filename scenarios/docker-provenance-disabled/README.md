# Docker Image Published Without Provenance Attestation

**Check:** SUPPLY-006 | **Severity:** Medium | **Auto-Fix:** No (CI change)

Docker images published with `provenance: false` in CI workflow, disabling SLSA supply chain attestation. Users cannot verify the image was built from the claimed source code. Discovered in OpenClaw's docker-release workflow.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Set `provenance: true` in GitHub Actions docker/build-push-action.
