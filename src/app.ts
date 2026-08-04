import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { corsOrigins, isProduction } from './config/env.js';
import { globalApiRateLimiter } from './middlewares/rateLimiter.js';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Behind a load balancer, req.ip must come from X-Forwarded-For or every
// client collapses into one rate-limit bucket.
app.set('trust proxy', isProduction ? 1 : false);

app.use(helmet({ contentSecurityPolicy: false }));

app.use(
  cors({
    // An explicit allowlist in production; reflect the origin only in dev.
    origin: corsOrigins ?? true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use(express.static(path.join(__dirname, '../public')));

app.use(globalApiRateLimiter);

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'Health Buddy Backend',
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

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
