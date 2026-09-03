# Performance

Measured, not estimated. Reproduce with `npm run loadtest`.

## What was run

A local stack — Node 24, PostgreSQL 18 on the same machine, no Redis (the
process-local fallback, which is why the cache column reads `false`). Numbers
from a developer laptop are not production numbers; what they are good for is
*relative* cost between endpoints and finding things that fall over.

```bash
npm run dev
npm run loadtest -- --duration 2 --concurrency 10
```

## Results

30 concurrent connections, all reads, seeded catalogue:

| Scenario | Throughput | p50 | p95 | p99 | What it exercises |
| --- | --- | --- | --- | --- | --- |
| `health` | 16,366/s | 0ms | 1ms | 4ms | Bare request path — routing, helmet, CSP, limiter |
| `readiness` | 10,430/s | 1ms | 1ms | 4ms | A real `SELECT 1` plus the Redis status check |
| `unauthenticated-401` | 10,129/s | 1ms | 1ms | 5ms | Rejection path, including the session lookup |
| `lab-packages` | 4,559/s | 2ms | 3ms | 4ms | Public lab catalogue |
| `catalogue` | 4,442/s | 2ms | 3ms | 6ms | Paginated medicine search |
| `emergency-directory` | 4,363/s | 2ms | 3ms | 4ms | Unauthenticated geo query |
| `catalogue-by-pincode` | 2,962/s | 3ms | 4ms | 7ms | The same, joined through serviceability + per-area pricing |

**No faults.** No 500s and no dropped connections in any scenario.

## Findings

### The rate limiter is the first thing you hit, and it holds

At the default 300 requests/minute per IP, every scenario saturates almost
immediately — the first run measured *the limiter* and nothing else. That is
worth knowing once: under a flood it served ~14,000 429/s at p99 4ms without
faulting, so it will not itself be the thing that falls over.

It also meant the limit had to become configurable to measure anything behind
it. `RATE_LIMIT_PER_MINUTE` now exists (default 300, unchanged in behaviour) for
exactly two reasons: a deployment behind a CDN or corporate NAT sees many real
users share one address, and a load test needs to get past it. The load test
detects a saturated run and says so rather than reporting meaningless numbers.

### `catalogue-by-pincode` is the slowest endpoint — and it is not an index problem

It runs at about two-thirds the throughput of the plain catalogue. The obvious
suspicion is a missing index on the serviceability join, so that was tested
rather than assumed:

- Built a scratch database with **5,000 medicines, 120,000 inventory lines, 400
  pharmacies, 4,800 service areas** — a plausible national catalogue.
- Timed the exact query the load test flagged.

**Result: p50 3.5ms, p95 4.4ms.** It holds up. The difference in the load test
is the extra work of the nested `include` and result assembly, not data volume.

No index was added. A speculative index has a real cost on every write to that
table, and the measurement says it would buy nothing.

> The original load test ran against **11 medicines and 22 inventory rows**,
> where Postgres seq-scans everything and is right to. Any conclusion about
> indexes drawn from a dataset that size would have been worthless. This is the
> main reason to keep the scale probe in mind when re-running.

### Offset pagination degrades as expected, and the ceiling bounds it

Over 5,000 rows:

| Page | p50 |
| --- | --- |
| 1 | 2.5ms |
| 10 | 2.9ms |
| 50 | 5.4ms |
| 100 | 7.2ms |
| 250 | 8.0ms |
| 1000 (the `MAX_PAGE` cap) | 8.0ms |

About 3× from first page to last, which is the expected cost of an offset scan.
It stays under 10ms because `MAX_PAGE` caps how deep a caller can go — which is
what that ceiling is for. At millions of rows this would become the argument for
cursor pagination on the specific list that needs it; it is not one yet.

## What has NOT been measured

Being explicit, because an unmeasured path is not a fast one:

- **Writes under contention.** Checkout, slot booking and stock reservation all
  take locks. The concurrency tests prove they are *correct* under races; they
  say nothing about throughput.
- **Anything with a real Redis.** These ran on the process-local fallback. Redis
  adds a network hop to every rate-limit and session-state check.
- **Anything with a real network.** Same-machine loopback has no latency,
  no packet loss, and no TLS handshake.
- **Production hardware, and a database with a year of real data in it.**

Before launch, re-run this against staging with Redis attached and the catalogue
loaded, and compare the *shape* rather than the absolute numbers.
