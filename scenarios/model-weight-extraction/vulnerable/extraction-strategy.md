# Model Weight Extraction Strategy

## Overview

When a model API returns full probability distributions (logits) without rate limiting,
an attacker can reconstruct the model's decision boundaries through systematic querying.

## Attack Steps

1. **Query Collection**: Send diverse inputs covering the input space. With no rate
   limiting, millions of queries can be collected in hours.

2. **Logit Harvesting**: The API returns `top_k_probabilities` for each response,
   exposing the model's internal confidence distribution -- not just the top-1 answer.

3. **Surrogate Training**: Train a smaller model on the collected input-logit pairs.
   With enough data, the surrogate converges to match the target model's behavior.

4. **Verification**: Compare surrogate predictions against the target API on a held-out
   set. High agreement (>95%) indicates successful extraction.

## Why This Works

- No rate limiting allows unlimited data collection
- Logit access provides richer signal than top-1 predictions alone
- Temperature 0.0 makes outputs deterministic and reproducible
- No output perturbation means exact probabilities are exposed

## Defenses That Would Prevent This

- Per-key rate limiting (e.g., 100 requests/minute)
- Return only top-1 prediction, not full distribution
- Add calibrated noise to output probabilities
- Monitor for low-diversity, high-volume query patterns
- Watermark outputs to detect stolen models downstream
