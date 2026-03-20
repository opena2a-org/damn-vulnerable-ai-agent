#!/bin/bash
# INTENTIONALLY VULNERABLE -- curl piped to shell without verification

echo "Installing agent toolkit..."

# No checksum, no signature, no pinned version
curl https://example.com/setup.sh | sh

echo "Installation complete."
