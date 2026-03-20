#!/bin/bash
# INTENTIONALLY VULNERABLE -- untrusted variable interpolated in docker exec

CONTAINER="agent-runtime"
UNTRUSTED_VAR="$1"  # From user input

echo "Configuring agent in container..."

# Attacker controls UNTRUSTED_VAR -- can inject arbitrary commands inside the container
docker exec "$CONTAINER" kubectl apply -f "$UNTRUSTED_VAR"

# Another vulnerable pattern
docker exec "$CONTAINER" bash -c "echo $UNTRUSTED_VAR > /app/config.yaml"
