#!/bin/bash
# INTENTIONALLY VULNERABLE -- hardcoded /tmp paths without mktemp

echo "Building agent package..."

# Predictable temp file -- attacker can pre-create symlink to overwrite arbitrary files
echo "agent-config: production" > /tmp/output.txt
echo "version: 1.0.0" >> /tmp/output.txt

# Another hardcoded temp path
tar czf /tmp/agent-build.tar.gz src/

# Predictable log path
echo "Build completed at $(date)" > /tmp/build.log

echo "Build artifacts written to /tmp/output.txt"
