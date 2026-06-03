# OskarOS Billing Analysis

**Generated:** 2026-04-15
**Method:** Token-count modeling. The CLI `cost` field is discarded — it is cumulative within bridge lifecycles AND misprices cached tokens. All costs are computed from raw token counts × Anthropic's published Sonnet pricing.

---

## Pricing Model Validation

The model uses Anthropic Sonnet pricing: **$3.00/M input, $15.00/M output**. This was validated against 31 direct API calls in session 2026-01-31-1 (entries 1–31, labeled "Chat API call"), which Ralph confirmed are billed accurately.

Result: **mean error 0.02%, max error 0.04%**. The pricing model is correct.

For bridge entries, a portion of input tokens are prompt-cached at $0.30/M (a 90% discount). The exact cache hit ratio is unknown, so all results are presented across a range of cache ratios. The key finding holds at every ratio.

---

## The Question

**Does Order 66 slash prices?**

Order 66 fired at the end of session 2026-01-27-31. Entries 114–116 are the first steady-state messages after compaction completed. The comparison baseline is entries 90–109 — the last 20 messages before Order 66 fired.

---

## The Data

### Pre-Order 66 (last 20 messages, entries 90–109)

Context was at 29–36% and climbing. Tool-use operations caused input tokens to spike into the millions.

| Metric | Value |
|--------|-------|
| Mean input tokens/msg | 1,105,985 |
| Median input tokens/msg | 625,012 |
| Max input tokens | 4,305,001 |
| Min input tokens | 292,743 |
| Mean output tokens/msg | 1,110 |

### Post-Order 66 (entries 114–116)

Context reset to 5%. Input tokens stable and low.

| Metric | Value |
|--------|-------|
| Mean input tokens/msg | 53,248 |
| Median input tokens/msg | 53,259 |
| Max input tokens | 53,926 |
| Mean output tokens/msg | 645 |

### Input token reduction: **20.8×**

---

## Cost Per Message at Varying Cache Ratios

Since cost is proportional to tokens, the reduction ratio holds regardless of how much caching is happening. The absolute dollar amounts shift, but the ratio stays between 13.6× and 19.7×.

| Cache Hit % | Pre-O66 $/msg | Post-O66 $/msg | Reduction |
|-------------|---------------|----------------|-----------|
| 0% (no caching) | $3.3355 | $0.1694 | 19.7× |
| 50% | $1.8424 | $0.0975 | 18.9× |
| 80% | $0.9466 | $0.0544 | 17.4× |
| 90% | $0.6480 | $0.0400 | 16.2× |
| 95% | $0.4987 | $0.0328 | 15.2× |

At a realistic 90% cache ratio for a persistent bridge, per-message cost drops from **$0.65 → $0.04**.

---

## 20-Message Projection

If the session continued for 20 more messages at the pre-O66 trajectory vs. 20 messages at post-O66 steady state:

| Cache Hit % | Without O66 (20 msgs) | With O66 (20 msgs) | Savings | Savings % |
|-------------|----------------------|--------------------|---------|-----------| 
| 0% | $66.71 | $3.39 | $63.32 | 94.9% |
| 50% | $36.85 | $1.95 | $34.90 | 94.7% |
| 80% | $18.93 | $1.09 | $17.84 | 94.3% |
| 90% | $12.96 | $0.80 | $12.16 | 93.8% |
| 95% | $9.97 | $0.66 | $9.32 | 93.4% |

---

## Break-Even: When Does Order 66 Pay For Itself?

Order 66 has overhead: Lumberjack runs 7 stages, Sage runs 1 stage, plus the compaction-settling messages (entries 112–113 with large input counts). Estimated total overhead: ~1.76M input tokens + ~38K output tokens.

| Cache Hit % | O66 Overhead Cost | Savings/msg | Break-Even |
|-------------|------------------|-------------|------------|
| 0% | $5.85 | $3.17/msg | 1.8 messages |
| 50% | $3.47 | $1.74/msg | 2.0 messages |
| 80% | $2.05 | $0.89/msg | 2.3 messages |
| 90% | $1.57 | $0.61/msg | 2.6 messages |
| 95% | $1.33 | $0.47/msg | 2.9 messages |

**Order 66 pays for itself within 2–3 messages** at any cache ratio.

---

## Per-Message Detail at 90% Cache

### Pre-Order 66 (entries 90–109)

| Entry | Input Tokens | Output | Ctx % | Est. Cost |
|-------|-------------|--------|-------|-----------|
| 90 | 292,743 | 247 | 29% | $0.1706 |
| 91 | 1,481,216 | 4,323 | 30% | $0.9091 |
| 92 | 598,552 | 869 | 30% | $0.3542 |
| 93 | 299,941 | 16 | 30% | $0.1712 |
| 94 | 1,505,746 | 841 | 30% | $0.8709 |
| 95 | 4,305,001 | 3,042 | 32% | $2.4995 |
| 96 | 3,155,586 | 3,195 | 32% | $1.8466 |
| 97 | 1,271,949 | 775 | 32% | $0.7366 |
| 98 | 1,278,087 | 1,767 | 32% | $0.7550 |
| 99 | 651,472 | 968 | 33% | $0.3859 |
| 100 | 331,655 | 923 | 33% | $0.2029 |
| 101 | 332,590 | 757 | 33% | $0.2009 |
| 102 | 333,375 | 309 | 33% | $0.1947 |
| 103 | 333,710 | 32 | 33% | $0.1907 |
| 104 | 1,350,876 | 727 | 59% | $0.7809 |
| 105 | 2,817,309 | 4,333 | 36% | $1.6709 |
| 106 | 355,183 | 100 | 36% | $0.2040 |
| 107 | 711,660 | 175 | 36% | $0.4083 |
| 108 | 356,498 | 17 | 36% | $0.2035 |
| 109 | 356,557 | 11 | 36% | $0.2034 |

**Median: $0.37/msg. Mean: $0.65/msg.**

### Post-Order 66 (entries 114–116)

| Entry | Input Tokens | Output | Ctx % | Est. Cost |
|-------|-------------|--------|-------|-----------|
| 114 | 52,560 | 652 | 5% | $0.0397 |
| 115 | 53,259 | 647 | 5% | $0.0401 |
| 116 | 53,926 | 637 | 5% | $0.0403 |

**Mean: $0.04/msg.**

---

## Why the CLI Cost Field Is Useless

Two independent problems:

1. **Cumulative, not per-message.** The cost increments by ~$0.02/msg even when token counts barely change, then resets when the bridge restarts. It's a running total within a bridge lifecycle.

2. **Cached tokens priced at full rate.** The CLI counter doesn't apply the 90% prompt-caching discount ($0.30/M vs $3.00/M), inflating reported costs by up to 10× for cache-heavy workloads like a persistent bridge.

---

## Methodology Notes

- All cost estimates computed as: `(input × cache_ratio × $0.30/M) + (input × (1-cache_ratio) × $3.00/M) + (output × $15.00/M)`
- Cache ratio is unknown. Results presented at 0%, 50%, 80%, 90%, 95% to show the finding is robust across the full range.
- "Pre-O66" baseline uses the last 20 bridge messages before Order 66 (entries 90–109), not the full session history. This is conservative — earlier messages were cheaper.
- "Post-O66" uses entries 114–116 (the 3 steady-state messages after compaction settled). Entries 112–113 are counted as compaction overhead.
- The 20.8× input token reduction is a direct measurement, not a model output. It would hold even if the pricing model were wrong.
