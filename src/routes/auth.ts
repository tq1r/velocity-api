import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import jwt from 'jsonwebtoken';
import { getDb } from '../db.js';
import type { AuthUser } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3456}`;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:1420';

router.get('/github', (req, res) => {
  const state = uuid();
  const redirect = (req.query.redirect as string) || FRONTEND_URL;
  const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${BASE_URL}/api/auth/github/callback&state=${state}&scope=read:user,user:email`;
  res.cookie('auth_redirect', redirect, { httpOnly: true, sameSite: 'none', secure: true, maxAge: 300000 });
  res.cookie('auth_state', state, { httpOnly: true, sameSite: 'none', secure: true, maxAge: 300000 });
  res.redirect(url);
});

router.get('/github/callback', async (req, res) => {
  const { code } = req.query;
  const stateCookie = req.cookies?.auth_state;
  const redirectUrl = req.cookies?.auth_redirect || FRONTEND_URL;
  if (!code || typeof code !== 'string') {
    res.status(400).send('Missing code');
    return;
  }

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code }),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) {
      res.redirect(`${redirectUrl}?error=oauth_failed`);
      return;
    }

    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const ghUser = await userRes.json() as any;

    const emailRes = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const emails = await emailRes.json() as any[];
    const primaryEmail = emails.find((e: any) => e.primary)?.email || emails[0]?.email;

    const db = getDb();
    const existing = db.prepare('SELECT * FROM users WHERE github_id = ?').get(String(ghUser.id)) as any;

    let userId: string;
    if (existing) {
      userId = existing.id;
      db.prepare('UPDATE users SET email = ?, name = ?, avatar_url = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(primaryEmail || existing.email, ghUser.login || existing.name, ghUser.avatar_url || existing.avatar_url, userId);
    } else {
      userId = uuid();
      db.prepare('INSERT INTO users (id, github_id, email, name, avatar_url) VALUES (?, ?, ?, ?, ?)')
        .run(userId, String(ghUser.id), primaryEmail || '', ghUser.login || '', ghUser.avatar_url || '');
    }

    const sessionToken = uuid();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const sessionId = uuid();
    db.prepare('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)')
      .run(sessionId, userId, sessionToken, expiresAt);

    const jwtToken = jwt.sign({ sessionId, userId, githubToken: tokenData.access_token }, JWT_SECRET, { expiresIn: '30d' });
    const separator = redirectUrl.includes('?') ? '&' : '?';
    res.redirect(`${redirectUrl}${separator}token=${jwtToken}`);
  } catch (err) {
    console.error('GitHub OAuth error:', err);
    res.status(500).send('OAuth failed');
  }
});

router.get('/google', (req, res) => {
  const state = uuid();
  const redirect = (req.query.redirect as string) || FRONTEND_URL;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${BASE_URL}/api/auth/google/callback&response_type=code&scope=openid%20profile%20email&state=${state}`;
  res.cookie('auth_redirect', redirect, { httpOnly: true, sameSite: 'none', secure: true, maxAge: 300000 });
  res.cookie('auth_state', state, { httpOnly: true, sameSite: 'none', secure: true, maxAge: 300000 });
  res.redirect(url);
});

router.get('/google/callback', async (req, res) => {
  const { code } = req.query;
  const redirectUrl = req.cookies?.auth_redirect || FRONTEND_URL;
  if (!code || typeof code !== 'string') {
    res.status(400).send('Missing code');
    return;
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, code, redirect_uri: `${BASE_URL}/api/auth/google/callback`, grant_type: 'authorization_code' }),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) {
      res.redirect(`${redirectUrl}?error=oauth_failed`);
      return;
    }

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser = await userRes.json() as any;

    const db = getDb();
    const existing = db.prepare('SELECT * FROM users WHERE google_id = ?').get(String(googleUser.id)) as any;

    let userId: string;
    if (existing) {
      userId = existing.id;
      db.prepare('UPDATE users SET email = ?, name = ?, avatar_url = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(googleUser.email || existing.email, googleUser.name || existing.name, googleUser.picture || existing.avatar_url, userId);
    } else {
      userId = uuid();
      db.prepare('INSERT INTO users (id, google_id, email, name, avatar_url) VALUES (?, ?, ?, ?, ?)')
        .run(userId, String(googleUser.id), googleUser.email || '', googleUser.name || '', googleUser.picture || '');
    }

    const sessionToken = uuid();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const sessionId = uuid();
    db.prepare('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)')
      .run(sessionId, userId, sessionToken, expiresAt);

    const jwtToken = jwt.sign({ sessionId, userId }, JWT_SECRET, { expiresIn: '30d' });
    const separator = redirectUrl.includes('?') ? '&' : '?';
    res.redirect(`${redirectUrl}${separator}token=${jwtToken}`);
  } catch (err) {
    console.error('Google OAuth error:', err);
    res.status(500).send('OAuth failed');
  }
});

router.get('/me', requireAuth, (req, res) => {
  const user = req.user!;
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    avatar_url: user.avatar_url,
    premium_tier: user.premium_tier,
    premium_expires_at: user.premium_expires_at,
  });
});

router.post('/logout', requireAuth, (req, res) => {
  const authHeader = req.headers.authorization!;
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sessionId: string };
    const db = getDb();
    db.prepare('DELETE FROM sessions WHERE id = ?').run(payload.sessionId);
  } catch {}
  res.json({ ok: true });
});

export default router;
