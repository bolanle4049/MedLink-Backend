import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import config from './config';
import openapiSpec from './docs/openapi';
import globalDB from './database/db';
import authRoutes from './routes/authRoutes';
import casesRoutes from './routes/casesRoutes';
import facilityRoutes from './routes/facilityRoutes';
import twilioRoutes from './routes/twilioRoutes';
import { startEscalationWorker } from './services/escalationWorker';

const app = express();

// Behind a tunnel/proxy (ngrok, load balancer), trust X-Forwarded-* so
// req.protocol/host reflect the real public HTTPS URL. Twilio signs the
// public URL, so the signature check must reconstruct that same URL.
app.set('trust proxy', true);

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// CORS Middleware
app.use(cors({
  origin: (origin, callback) => {
    // Allow any origin for development / hackathon
    callback(null, origin || true);
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Content-Length', 'Accept-Encoding', 'X-CSRF-Token', 'Authorization', 'accept', 'origin', 'Cache-Control', 'X-Requested-With'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/uploads', express.static(uploadsDir));

// Self-contained test console (patient simulator + doctor workspace).
app.get('/console', (_req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), 'public', 'console.html'));
});

// API docs: Swagger UI at /docs, raw spec at /openapi.json.
app.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(openapiSpec);
});
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec as any, { customSiteTitle: 'MedLink API' }));

// Routes
app.use('/api/twilio', twilioRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/cases', casesRoutes);
app.use('/api/facilities', facilityRoutes);

// Health Check Endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'MedLink Backend API'
  });
});

async function startServer() {
  await globalDB.init();

  // No-response safety net (Spec Section 17).
  startEscalationWorker();

  const server = app.listen(config.port, () => {
    console.log('==================================================');
    console.log(`🚀 MedLink AI Triage & Doctor Auth Backend (Node.js/TS) on port ${config.port}`);
    console.log(`📌 Health Check: GET http://localhost:${config.port}/health`);
    console.log(`📌 Twilio Webhook: POST http://localhost:${config.port}/api/twilio/webhook`);
    console.log(`📌 Patient Simulation: POST http://localhost:${config.port}/api/twilio/simulate-patient`);
    console.log(`📌 Auth:`);
    console.log(`   POST /api/auth/register (bootstrap MedLink admin only)`);
    console.log(`   POST /api/auth/login`);
    console.log(`   POST /api/auth/first-login-reset`);
    console.log(`   GET  /api/auth/me`);
    console.log(`📌 Facility admin (Spec §12):`);
    console.log(`   POST /api/facilities (medlink_admin)`);
    console.log(`   POST /api/facilities/:facilityId/doctors`);
    console.log(`   POST /api/facilities/:facilityId/enrollees`);
    console.log(`   GET  /api/facilities/:facilityId/stats`);
    console.log(`📌 Doctor triage queue (facility-scoped):`);
    console.log(`   GET  /api/cases  |  GET /api/cases/:id`);
    console.log(`   POST /api/cases/:id/claim | /override | /reply`);
    console.log('==================================================');
  });

  return server;
}

if (process.env.NODE_ENV !== 'test' && !module.parent) {
  startServer();
}

export { app, startServer };
export default app;
