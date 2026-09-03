import { env, isProduction } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Where a 500 goes when nobody is watching the logs.
 *
 * Without this, the platform finds out it is broken from a patient who could
 * not order their medicine. `logger.error` writes to stdout, which is fine
 * while someone is tailing it and useless at 3am — the failure scrolls past and
 * the only signal left is a support message days later, by which time the
 * request that caused it is unreconstructable.
 *
 * Shaped like the other providers here (payments, video, SMS): an interface
 * with a no-op default, chosen by configuration. `SENTRY_DSN` unset means the
 * reporter does nothing, which is the right behaviour for development and for a
 * deployment that has not signed up for anything — and it means no code outside
 * this file has to know whether reporting is on.
 *
 * Deliberately *not* the Sentry SDK. Adding a dependency that opens a transport,
 * patches globals and ships breadcrumbs is a decision about a third party
 * receiving health-adjacent request context, and it should be made explicitly
 * rather than inherited from a library default. This posts the minimum over the
 * documented envelope endpoint: what broke, where, and nothing about who.
 */

export interface ErrorContext {
  /** `GET /api/v1/patients/me` — never the query string, which carries ids. */
  route?: string;
  /** The account, by id only. Never a phone number or a name. */
  userId?: string;
  /** Our own request correlation id, when there is one. */
  requestId?: string;
}

export interface ErrorReporter {
  readonly name: string;
  capture(error: unknown, context?: ErrorContext): void;
}

const noopReporter: ErrorReporter = {
  name: 'none',
  capture() {
    /* Logged by the caller either way. */
  },
};

/**
 * Parses a DSN into the envelope URL and key.
 *
 * A DSN is `https://<key>@<host>/<projectId>`, and the ingest endpoint is
 * `https://<host>/api/<projectId>/envelope/`. Doing this by hand is a dozen
 * lines; the alternative is the full SDK.
 */
const parseDsn = (dsn: string): { url: string; key: string } | null => {
  try {
    const parsed = new URL(dsn);
    const projectId = parsed.pathname.replace(/^\//, '');
    if (!parsed.username || !projectId) return null;
    return {
      url: `${parsed.protocol}//${parsed.host}/api/${projectId}/envelope/`,
      key: parsed.username,
    };
  } catch {
    return null;
  }
};

const sentryReporter = (dsn: string): ErrorReporter => {
  const target = parseDsn(dsn);
  if (!target) {
    logger.error('[errors] SENTRY_DSN is not a valid DSN — error reporting is OFF.');
    return noopReporter;
  }

  return {
    name: 'sentry',

    capture(error, context) {
      const err = error instanceof Error ? error : new Error(String(error));

      const event = {
        event_id: crypto.randomUUID().replace(/-/g, ''),
        timestamp: new Date().toISOString(),
        platform: 'node',
        level: 'error',
        environment: env.NODE_ENV,
        server_name: 'healthbuddy-backend',
        transaction: context?.route,
        exception: {
          values: [
            {
              type: err.name,
              value: err.message,
              stacktrace: { frames: framesFrom(err) },
            },
          ],
        },
        // Ids only. A crash report is not a reason to ship a patient's phone
        // number to a third party.
        user: context?.userId ? { id: context.userId } : undefined,
        tags: context?.requestId ? { request_id: context.requestId } : undefined,
      };

      const body = [
        JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString(), dsn }),
        JSON.stringify({ type: 'event' }),
        JSON.stringify(event),
      ].join('\n');

      /**
       * Fire and forget, and never throw.
       *
       * This runs inside the error handler. An exception here would replace a
       * useful 500 with a confusing one, and awaiting it would add the
       * reporting service's latency to a response that has already failed.
       */
      void fetch(target.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${target.key}, sentry_client=healthbuddy/1.0`,
        },
        body,
        signal: AbortSignal.timeout(5_000),
      }).catch((err: unknown) => {
        logger.warn(`[errors] could not report: ${(err as Error).message}`);
      });
    },
  };
};

/** Turns a stack string into the frame shape the envelope expects. */
const framesFrom = (err: Error) =>
  (err.stack ?? '')
    .split('\n')
    .slice(1, 30)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '))
    .map((line) => {
      const match = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
      return {
        function: match?.[1] ?? '<anonymous>',
        filename: match?.[2] ?? line,
        lineno: Number(match?.[3] ?? 0),
        colno: Number(match?.[4] ?? 0),
      };
    })
    // Sentry orders frames oldest-first; a stack is newest-first.
    .reverse();

export const errorReporter: ErrorReporter = env.SENTRY_DSN
  ? sentryReporter(env.SENTRY_DSN)
  : noopReporter;

if (isProduction && errorReporter.name === 'none') {
  // A warning rather than a refusal to boot: an unmonitored platform is a bad
  // idea, but it still treats patients, and refusing to start would be worse.
  logger.warn(
    '[errors] SENTRY_DSN is not set — nothing is collecting production faults. ' +
      'You will hear about them from users.'
  );
}
