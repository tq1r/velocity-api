import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { getDb } from './db.js';
import authRoutes from './routes/auth.js';
import premiumRoutes from './routes/premium.js';

const PORT = parseInt(process.env.PORT || '3456', 10);
const HOST = process.env.HOST || '0.0.0.0';
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:1420,http://localhost:5173,tauri://localhost').split(',');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'velocity-api', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/premium', premiumRoutes);

getDb();

app.listen(PORT, HOST, () => {
  console.log(`Velocity API running at http://${HOST}:${PORT}`);
});
