import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db.js';
import { requireAuth, requireBotAuth } from '../middleware/auth.js';

const router = Router();

function isPremiumActive(user: any): boolean {
  if (user.premium_tier === 'lifetime') return true;
  if (user.premium_tier === 'monthly' && user.premium_expires_at) {
    return new Date(user.premium_expires_at) > new Date();
  }
  return false;
}

router.post('/upgrade', requireBotAuth, (req, res) => {
  const { user_id, tier } = req.body as { user_id?: string; tier?: string };

  if (!user_id || !tier || !['monthly', 'lifetime'].includes(tier)) {
    res.status(400).json({ error: 'user_id (string) and tier (monthly|lifetime) required' });
    return;
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id) as any;

  if (!user) {
    res.status(404).json({ error: 'User not found. They must sign in first.' });
    return;
  }

  const expiresAt = tier === 'monthly'
    ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    : null;

  db.prepare('UPDATE users SET premium_tier = ?, premium_expires_at = ?, premium_updated_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?')
    .run(tier, expiresAt, user_id);

  db.prepare('INSERT INTO premium_logs (user_id, action, tier, performed_by, note) VALUES (?, ?, ?, ?, ?)')
    .run(user_id, 'upgrade', tier, 'discord-bot', `Upgraded to ${tier} via Discord`);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id) as any;

  res.json({
    ok: true,
    user: {
      id: updated.id,
      name: updated.name,
      premium_tier: updated.premier_tier || updated.premium_tier,
      premium_expires_at: updated.premium_expires_at,
    },
  });
});

router.post('/revoke', requireBotAuth, (req, res) => {
  const { user_id } = req.body as { user_id?: string };

  if (!user_id) {
    res.status(400).json({ error: 'user_id required' });
    return;
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id) as any;

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  db.prepare('UPDATE users SET premium_tier = NULL, premium_expires_at = NULL, premium_updated_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?')
    .run(user_id);

  db.prepare('INSERT INTO premium_logs (user_id, action, tier, performed_by) VALUES (?, ?, ?, ?)')
    .run(user_id, 'revoke', user.premium_tier, 'discord-bot');

  res.json({ ok: true });
});

router.get('/check/:user_id', requireBotAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.user_id) as any;

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({
    id: user.id,
    name: user.name,
    premium: isPremiumActive(user),
    premium_tier: user.premium_tier,
    premium_expires_at: user.premium_expires_at,
  });
});

router.get('/stats', requireBotAuth, (req, res) => {
  const db = getDb();

  const totalUsers = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count;
  const lifetime = (db.prepare('SELECT COUNT(*) as count FROM users WHERE premium_tier = \'lifetime\'').get() as any).count;
  const monthly = (db.prepare('SELECT COUNT(*) as count FROM users WHERE premium_tier = \'monthly\' AND premium_expires_at > datetime(\'now\')').get() as any).count;
  const activePremium = lifetime + monthly;

  const recentLogs = db.prepare('SELECT * FROM premium_logs ORDER BY created_at DESC LIMIT 20').all();

  res.json({
    total_users: totalUsers,
    lifetime_premium: lifetime,
    active_monthly: monthly,
    active_premium: activePremium,
    recent_logs: recentLogs,
  });
});

router.get('/status', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any;
  res.json({
    premium: isPremiumActive(user),
    tier: user.premium_tier,
    expires_at: user.premium_expires_at,
  });
});

export default router;
