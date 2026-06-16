import { Router } from 'express';
import { getDb } from '../db.js';
import { requireBotAuth, requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/owner', requireAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'owner_user_id'").get() as any;
  res.json({ owner_user_id: row?.value || null });
});

router.post('/owner', requireBotAuth, (req, res) => {
  const { user_id } = req.body as { user_id?: string };
  if (!user_id) {
    res.status(400).json({ error: 'user_id required' });
    return;
  }
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('owner_user_id', ?)").run(user_id);
  res.json({ ok: true, owner_user_id: user_id });
});

export default router;
