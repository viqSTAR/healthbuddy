import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { corsOrigins, isProduction } from './config/env.js';
import { isDatabaseReady } from './config/db.js';
import { isStoreReady } from './config/redis.js';
import { globalApiRateLimiter, webhookRateLimiter } from './middlewares/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';

import authRoutes from './routes/authRoutes.js';
import patientRoutes from './routes/patientRoutes.js';
import doctorRoutes from './routes/doctorRoutes.js';
import appointmentRoutes from './routes/appointmentRoutes.js';
import prescriptionRoutes from './routes/prescriptionRoutes.js';
import pharmacyRoutes from './routes/pharmacyRoutes.js';
import labRoutes from './routes/labRoutes.js';
import emergencyRoutes from './routes/emergencyRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import applicationRoutes from './routes/applicationRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import inventoryRoutes from './routes/inventoryRoutes.js';
import fulfilmentRoutes from './routes/fulfilmentRoutes.js';
import healthRoutes from './routes/healthRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import videoRoutes from './routes/videoRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import agentRoutes from './routes/agentRoutes.js';
import { webhookHandler as paymentWebhookHandler } from './controllers/paymentController.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Behind a load balancer, req.ip must come from X-Forwarded-For or every
// client collapses into one rate-limit bucket.
app.set('trust proxy', isProduction ? 1 : false);

/**
 * helmet's own CSP is left off and the policy set explicitly below, because this
 * process serves two things with opposite needs: JSON and user-uploaded files,
 * which must never execute anything, and one hand-written landing page that
 * pulls Tailwind and Google Fonts from CDNs. A single policy either breaks the
 * page or is too weak to be worth setting. Everything else helmet does —
 * nosniff, frameguard, HSTS — still applies.
 */
app.use(helmet({ contentSecurityPolicy: false }));

/**
 * The default: nothing loads, nothing runs.
 *
 * This is the policy that covers document downloads. A lab report or a licence
 * is attacker-supplied bytes served back under a MIME type the uploader chose,
 * so the response that carries it should have no ability to fetch or execute
 * anything. `img-src`/`media-src` stay on 'self' so a report opened directly in
 * a browser tab still renders.
 */
const API_CSP =
  "default-src 'none'; img-src 'self' data: blob:; media-src 'self'; " +
  "object-src 'none'; frame-ancestors 'none'; base-uri 'none'";

app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy', API_CSP);
  next();
});

app.use(
  cors({
    // An explicit allowlist in production; reflect the origin only in dev.
    origin: corsOrigins ?? true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);

/**
 * The payment webhook is mounted BEFORE the JSON parser and takes the raw body.
 *
 * Its signature covers the exact bytes the gateway sent. Parsing to an object
 * and re-serialising changes key order and whitespace, so the HMAC would never
 * match and every real webhook would be rejected as a forgery.
 */
app.post(
  '/api/v1/payments/webhook',
  // Its own limiter: sitting ahead of the global one is what this route needs
  // for the raw body, and what previously left it entirely uncapped.
  webhookRateLimiter,
  express.raw({ type: '*/*', limit: '256kb' }),
  paymentWebhookHandler
);

// Reads the httpOnly refresh cookie the admin panel authenticates with.
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/**
 * The landing page overrides the strict default with a policy it can actually
 * run under. It is a static marketing page with no session and no patient data,
 * so the CDN allowances cost nothing that matters; 'unsafe-eval' is there
 * because the Tailwind Play CDN compiles classes in the browser.
 */
const PAGE_CSP =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' data: https://fonts.gstatic.com; " +
  "img-src 'self' data: https:; connect-src 'self'; " +
  "object-src 'none'; frame-ancestors 'none'; base-uri 'self'";

app.use(
  express.static(path.join(__dirname, '../public'), {
    setHeaders: (res) => res.setHeader('Content-Security-Policy', PAGE_CSP),
  })
);

app.use(globalApiRateLimiter);

/**
 * Liveness: is this process running?
 *
 * Deliberately answers without touching anything. An orchestrator uses this to
 * decide whether to *restart* the container, and restarting a healthy process
 * because the database is briefly unreachable turns a recoverable dependency
 * outage into a crash loop.
 */
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'Health Buddy Backend',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Readiness: should this process receive traffic?
 *
 * The distinction matters and was missing — there was only the liveness check,
 * so a load balancer kept routing to an instance whose database had gone away
 * and every request it received became a 500. This one checks the dependencies
 * a request actually needs, and answering 503 takes the instance out of
 * rotation until they come back.
 */
app.get('/health/ready', async (_req, res) => {
  const [database, cache] = await Promise.all([isDatabaseReady(), Promise.resolve(isStoreReady())]);

  // Redis has a documented process-local fallback outside production, so a
  // developer without it running is still "ready" — in production it is not
  // optional, and liveClient() refuses to serve from memory there anyway.
  const ready = database && (cache || !isProduction);

  res.status(ready ? 200 : 503).json({
    status: ready ? 'READY' : 'NOT_READY',
    checks: { database, cache },
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/patients', patientRoutes);
app.use('/api/v1/doctors', doctorRoutes);
app.use('/api/v1/appointments', appointmentRoutes);
app.use('/api/v1/prescriptions', prescriptionRoutes);
app.use('/api/v1/pharmacy', pharmacyRoutes);
app.use('/api/v1/labs', labRoutes);
app.use('/api/v1/emergency', emergencyRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/applications', applicationRoutes);
app.use('/api/v1/files', documentRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/inventory', inventoryRoutes);
app.use('/api/v1/fulfilment', fulfilmentRoutes);
app.use('/api/v1/health-content', healthRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/video', videoRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/agent', agentRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
