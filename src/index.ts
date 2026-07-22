import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import config from './config';
import globalDB from './database/db';
import authRoutes from './routes/authRoutes';
import casesRoutes from './routes/casesRoutes';
import twilioRoutes from './routes/twilioRoutes';

const app = express();

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

// Routes
app.use('/api/twilio', twilioRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/cases', casesRoutes);

// Health Check Endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'MedLink Backend API'
  });
});

async function startServer() {
  await globalDB.init();

  const server = app.listen(config.port, () => {
    console.log('==================================================');
    console.log(`🚀 MedLink AI Triage & Doctor Auth Backend (Node.js/TS) on port ${config.port}`);
    console.log(`📌 Health Check: GET http://localhost:${config.port}/health`);
    console.log(`📌 Twilio Webhook: POST http://localhost:${config.port}/api/twilio/webhook`);
    console.log(`📌 Patient Simulation: POST http://localhost:${config.port}/api/twilio/simulate-patient`);
    console.log(`📌 Doctor Auth:`);
    console.log(`   POST http://localhost:${config.port}/api/auth/register`);
    console.log(`   POST http://localhost:${config.port}/api/auth/login`);
    console.log(`   GET  http://localhost:${config.port}/api/auth/me`);
    console.log(`📌 Doctor Triage Queue (For Maaz Dashboard):`);
    console.log(`   GET  http://localhost:${config.port}/api/cases`);
    console.log(`   GET  http://localhost:${config.port}/api/cases/:id`);
    console.log(`   POST http://localhost:${config.port}/api/cases/:id/reply`);
    console.log('==================================================');
  });

  return server;
}

if (process.env.NODE_ENV !== 'test' && !module.parent) {
  startServer();
}

export { app, startServer };
export default app;
