/**
 * Load test. Finds what gives way first, and at what rate.
 *
 *   npm run loadtest                       # against http://localhost:5000
 *   npm run loadtest -- --url https://... --duration 60 --concurrency 100
 *
 * Not a benchmark. A benchmark produces a number to feel good about; this is
 * looking for the point where something *changes* — latency knees, error
 * classes appearing, a rate limiter engaging — because that is the thing worth
 * knowing before real traffic finds it for you.
 *
 * Deliberately no dependency. k6 and autocannon are better tools and both mean
 * a binary or a package on the path before anyone can run this; the whole value
 * here is that it runs today, on the machine you already have, against the
 * stack you already started.
 *
 * WHAT IT DOES NOT DO: write anything. Every scenario is a read, or an auth
 * call against throwaway phone numbers. Pointing it at production will not
 * create orders — but it will absolutely generate load and trip rate limits, so
 * point it at staging.
 */
import { performance } from 'node:perf_hooks';

interface Options {
  url: string;
  durationSeconds: number;
  concurrency: number;
}

const parseArgs = (): Options => {
  const arg = (name: string, fallback: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
  };

  return {
    url: arg('url', 'http://localhost:5000').replace(/\/+$/, ''),
    durationSeconds: Number(arg('duration', '15')),
    concurrency: Number(arg('concurrency', '25')),
  };
};

interface Sample {
  ms: number;
  status: number;
  ok: boolean;
}

interface Scenario {
  name: string;
  /** What it exercises, so a bad result is interpretable. */
  exercises: string;
  run: (base: string) => Promise<Sample>;
}

const timed = async (fn: () => Promise<Response>): Promise<Sample> => {
  const started = performance.now();
  try {
    const res = await fn();
    // Drain the body: leaving it unread keeps the socket busy and measures the
    // wrong thing entirely.
    await res.arrayBuffer();
    return { ms: performance.now() - started, status: res.status, ok: res.ok };
  } catch {
    return { ms: performance.now() - started, status: 0, ok: false };
  }
};

const SCENARIOS: Scenario[] = [
  {
    name: 'health',
    exercises: 'the bare request path — routing, helmet, CSP, rate limiter',
    run: (base) => timed(() => fetch(`${base}/health`)),
  },
  {
    name: 'readiness',
    exercises: 'a real query against Postgres plus the Redis status check',
    run: (base) => timed(() => fetch(`${base}/health/ready`)),
  },
  {
    name: 'catalogue',
    exercises: 'the busiest public read — paginated medicine search',
    run: (base) => timed(() => fetch(`${base}/api/v1/pharmacy/medicines?limit=20`)),
  },
  {
    name: 'catalogue-by-pincode',
    exercises: 'the same read joined through serviceability and per-area pricing',
    run: (base) =>
      timed(() => fetch(`${base}/api/v1/pharmacy/medicines?limit=20&pincode=400058`)),
  },
  {
    name: 'lab-packages',
    exercises: 'the other public catalogue',
    run: (base) => timed(() => fetch(`${base}/api/v1/labs/packages?limit=20`)),
  },
  {
    name: 'emergency-directory',
    exercises: 'an unauthenticated geo query — the one read that must never be slow',
    run: (base) =>
      timed(() =>
        fetch(`${base}/api/v1/health-content/emergency-services?latitude=19.13&longitude=72.83`)
      ),
  },
  {
    name: 'unauthenticated-401',
    exercises: 'the rejection path, including the session lookup that guards it',
    run: (base) => timed(() => fetch(`${base}/api/v1/patients/me`)),
  },
];

const percentile = (sorted: number[], p: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;

interface Summary {
  scenario: string;
  exercises: string;
  requests: number;
  rps: number;
  ok: number;
  failed: number;
  statuses: Record<number, number>;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

const runScenario = async (scenario: Scenario, opts: Options): Promise<Summary> => {
  const samples: Sample[] = [];
  const deadline = Date.now() + opts.durationSeconds * 1000;

  const worker = async () => {
    while (Date.now() < deadline) {
      samples.push(await scenario.run(opts.url));
    }
  };

  const startedAt = performance.now();
  await Promise.all(Array.from({ length: opts.concurrency }, worker));
  const elapsedSeconds = (performance.now() - startedAt) / 1000;

  const durations = samples.map((s) => s.ms).sort((a, b) => a - b);
  const statuses: Record<number, number> = {};
  for (const s of samples) statuses[s.status] = (statuses[s.status] ?? 0) + 1;

  return {
    scenario: scenario.name,
    exercises: scenario.exercises,
    requests: samples.length,
    rps: samples.length / elapsedSeconds,
    ok: samples.filter((s) => s.ok).length,
    failed: samples.filter((s) => !s.ok).length,
    statuses,
    p50: percentile(durations, 0.5),
    p95: percentile(durations, 0.95),
    p99: percentile(durations, 0.99),
    max: durations.at(-1) ?? 0,
  };
};

const ms = (n: number) => `${n.toFixed(0)}ms`.padStart(8);

const main = async () => {
  const opts = parseArgs();

  const reachable = await fetch(`${opts.url}/health`).catch(() => null);
  if (!reachable?.ok) {
    console.error(`\nCannot reach ${opts.url}. Start the server first (npm run dev).\n`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nLoad test — ${opts.url}\n` +
      `${opts.concurrency} concurrent, ${opts.durationSeconds}s per scenario, ` +
      `${SCENARIOS.length} scenarios\n`
  );

  const results: Summary[] = [];
  for (const scenario of SCENARIOS) {
    process.stdout.write(`  ${scenario.name.padEnd(24)}`);
    const summary = await runScenario(scenario, opts);
    results.push(summary);
    console.log(
      `${summary.rps.toFixed(0).padStart(6)} rps   ` +
        `p50 ${ms(summary.p50)}   p95 ${ms(summary.p95)}   p99 ${ms(summary.p99)}` +
        (summary.failed ? `   ${summary.failed} failed` : '')
    );
  }

  console.log('\n─── detail ───\n');
  for (const r of results) {
    console.log(`  ${r.scenario}  — ${r.exercises}`);
    console.log(
      `      ${r.requests} requests, ${r.rps.toFixed(0)}/s, ` +
        `p50 ${r.p50.toFixed(0)} p95 ${r.p95.toFixed(0)} p99 ${r.p99.toFixed(0)} max ${r.max.toFixed(0)}ms`
    );
    console.log(
      `      statuses: ${Object.entries(r.statuses)
        .map(([code, n]) => `${code === '0' ? 'network-error' : code}×${n}`)
        .join('  ')}\n`
    );
  }

  /**
   * The part worth reading.
   *
   * A wall of percentiles is data; these are the three questions someone
   * actually has, answered out loud.
   */
  console.log('─── findings ───\n');

  const slowest = [...results].sort((a, b) => b.p95 - a.p95)[0]!;
  console.log(`  Slowest at p95:  ${slowest.scenario} (${slowest.p95.toFixed(0)}ms)`);
  console.log(`                   ${slowest.exercises}`);

  /**
   * A run dominated by 429s measured the rate limiter, not the application.
   *
   * That is a real and reassuring result the first time — it says the limiter
   * holds under a flood without falling over — and useless every time after,
   * because the numbers no longer describe any code path anyone cares about.
   * Worth saying loudly rather than leaving someone to notice the status column.
   */
  const limited = results.filter((r) => r.statuses[429]);
  const saturated = results.filter((r) => (r.statuses[429] ?? 0) > r.requests * 0.5);

  if (limited.length) {
    console.log(
      `\n  Rate limited:    ${limited.map((r) => `${r.scenario} (${r.statuses[429]})`).join(', ')}`
    );

    if (saturated.length === results.length) {
      console.log(
        '\n  READ THIS:       every scenario was throttled, so these numbers describe the\n' +
          '                   rate limiter and not the application. The limiter itself held\n' +
          '                   up — no faults, low latency — which is worth knowing once.\n\n' +
          '                   To measure the app, raise the ceiling for the run:\n' +
          '                     RATE_LIMIT_PER_MINUTE=100000 npm run dev\n' +
          '                   then re-run. Never leave it raised on a real deployment.'
      );
    }
  }

  const broken = results.filter((r) => r.statuses[500] || r.statuses[0]);
  if (broken.length) {
    console.log(
      `\n  FAULTS:          ${broken
        .map((r) => `${r.scenario} (${(r.statuses[500] ?? 0) + (r.statuses[0] ?? 0)})`)
        .join(', ')}`
    );
    console.log('                   A 500 or a dropped connection under load is a real bug.');
    process.exitCode = 1;
  } else {
    console.log('\n  Faults:          none — no 500s, no dropped connections');
  }

  console.log('');
};

void main();
