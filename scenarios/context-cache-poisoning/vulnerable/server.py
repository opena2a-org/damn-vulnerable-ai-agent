"""
Vulnerable multi-tenant inference server with shared KV cache.
Demonstrates cross-tenant data leakage via prefix caching.
"""

# Shared cache -- no tenant isolation
kv_cache = {}

def get_cache_key(prompt_prefix):
    """VULNERABLE: Cache key does not include tenant ID.
    Two tenants with similar prompts share cached KV states,
    leaking context from one tenant to another."""
    return hash(prompt_prefix)

def inference(tenant_id, messages):
    prompt = build_prompt(messages)
    prefix = prompt[:512]
    cache_key = get_cache_key(prefix)  # No tenant scoping

    if cache_key in kv_cache:
        # VULNERABLE: Reuses cached KV from a different tenant
        # The cached context may contain another tenant's system prompt,
        # private data, or instructions
        cached_kv = kv_cache[cache_key]
        result = generate_with_cache(prompt, cached_kv)
    else:
        result, new_kv = generate_fresh(prompt)
        kv_cache[cache_key] = new_kv  # Stored without tenant ID

    return result

def build_prompt(messages):
    return "\n".join(m["content"] for m in messages)

def generate_with_cache(prompt, cached_kv):
    return {"response": "Generated with shared cache (may contain cross-tenant data)"}

def generate_fresh(prompt):
    return {"response": "Generated fresh"}, {"kv_state": "..."}
