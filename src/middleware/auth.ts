import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export interface AuthUser {
  id: string;
  github_id: string | null;
  google_id: string | null;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  premium_tier: string | null;
  premium_expires_at: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      botAuthenticated?: boolean;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sessionId: string; userId: string };
    const db = getDb();
    const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND token = ? AND expires_at > datetime(\'now\')').get(payload.sessionId, token) as any;
    if (!session) {
      res.status(401).json({ error: 'Session expired or invalid' });
      return;
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) as AuthUser | undefined;
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function requireBotAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const botKey = process.env.DISCORD_BOT_API_KEY;
  if (!botKey) {
    res.status(500).json({ error: 'Bot API key not configured' });
    return;
  }

  if (!authHeader?.startsWith('Bearer ') || authHeader.slice(7) !== botKey) {
    res.status(401).json({ error: 'Invalid bot API key' });
    return;
  }

  req.botAuthenticated = true;
  next();
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sessionId: string; userId: string };
    const db = getDb();
    const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND token = ? AND expires_at > datetime(\'now\')').get(payload.sessionId, token) as any;
    if (session) {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) as AuthUser | undefined;
      if (user) req.user = user;
    }
  } catch {}
  next();
}
