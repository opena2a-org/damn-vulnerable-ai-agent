deadline=$((SECONDS + 300))
while [ $SECONDS -lt $deadline ]; do
  attestations=$(npm view "damn-vulnerable-ai-agent" dist.attestations --json 2>&1 || true)
  if [ -n "$attestations" ] && [ "$attestations" != "null" ] && [ "$attestations" != "{}" ]; then
    echo "Provenance verified for damn-vulnerable-ai-agent"
    exit 0
  fi
  echo "Attestations not yet visible, retrying in 15s... (elapsed ${SECONDS}s)"
  sleep 15
done
echo "::error::Provenance attestations missing from npm for damn-vulnerable-ai-agent after 5 minutes"
exit 1
