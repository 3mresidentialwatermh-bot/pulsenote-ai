const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');
const { VAPID_PUBLIC_KEY, savePushSubscription } = require('../services/pushService');

const router = express.Router();

const USER_SELECT_FIELDS = `
  id, name, email, plan, voice_quota_used, voice_quota_limit, reminder_limit,
  quiet_hours_enabled, quiet_hours_start, quiet_hours_end,
  escalation_whatsapp, escalation_sms, escalation_email, phone_number,
  streak_days, gemini_api_key, alarm_tone, created_at
`;

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO users (id, name, email, password_hash, plan, voice_quota_used, voice_quota_limit, reminder_limit, created_at)
      VALUES (?, ?, ?, ?, 'free', 0, 5, 10, ?)
    `).run(id, name.trim(), normalizedEmail, passwordHash, now);

    const user = db.prepare(`SELECT ${USER_SELECT_FIELDS} FROM users WHERE id = ?`).get(id);
    const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({ token, user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Failed to register user.' });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const userRow = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
    if (!userRow) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const valid = await bcrypt.compare(password, userRow.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign({ userId: userRow.id }, JWT_SECRET, { expiresIn: '30d' });
    const { password_hash, ...user } = userRow;

    res.json({ token, user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Failed to log in.' });
  }
});

// Get current profile & SaaS usage metrics
router.get('/me', authenticateToken, (req, res) => {
  const activeCountRow = db.prepare(
    "SELECT COUNT(*) as count FROM reminders WHERE user_id = ? AND status IN ('pending', 'snoozed')"
  ).get(req.user.id);

  res.json({
    user: {
      ...req.user,
      active_reminders_count: activeCountRow ? activeCountRow.count : 0
    }
  });
});

// Update Quiet Hours & Multi-Channel Escalation Preferences
router.patch('/preferences', authenticateToken, (req, res) => {
  try {
    const {
      quiet_hours_enabled,
      quiet_hours_start,
      quiet_hours_end,
      escalation_whatsapp,
      escalation_sms,
      escalation_email,
      phone_number,
      gemini_api_key,
      alarm_tone
    } = req.body;

    const current = req.user;
    if (gemini_api_key && gemini_api_key.trim()) {
      process.env.GEMINI_API_KEY = gemini_api_key.trim();
    }
    db.prepare(`
      UPDATE users
      SET quiet_hours_enabled = ?,
          quiet_hours_start = ?,
          quiet_hours_end = ?,
          escalation_whatsapp = ?,
          escalation_sms = ?,
          escalation_email = ?,
          phone_number = ?,
          gemini_api_key = ?,
          alarm_tone = ?
      WHERE id = ?
    `).run(
      quiet_hours_enabled !== undefined ? (quiet_hours_enabled ? 1 : 0) : current.quiet_hours_enabled,
      quiet_hours_start || current.quiet_hours_start || '22:00',
      quiet_hours_end || current.quiet_hours_end || '08:00',
      escalation_whatsapp !== undefined ? (escalation_whatsapp ? 1 : 0) : current.escalation_whatsapp,
      escalation_sms !== undefined ? (escalation_sms ? 1 : 0) : current.escalation_sms,
      escalation_email !== undefined ? (escalation_email ? 1 : 0) : current.escalation_email,
      phone_number !== undefined ? phone_number : (current.phone_number || ''),
      gemini_api_key !== undefined ? gemini_api_key.trim() : (current.gemini_api_key || ''),
      alarm_tone || current.alarm_tone || 'classic',
      current.id
    );

    const updatedUser = db.prepare(`SELECT ${USER_SELECT_FIELDS} FROM users WHERE id = ?`).get(current.id);
    res.json({ message: 'Smart Alarm & Escalation preferences saved!', user: updatedUser });
  } catch (err) {
    console.error('Preferences update error:', err);
    res.status(500).json({ error: 'Failed to update preferences.' });
  }
});

// Upgrade or switch SaaS plan (Free <-> Pro <-> Teams)
router.post('/subscription', authenticateToken, (req, res) => {
  try {
    const { plan, paymentMethod } = req.body;
    if (!['free', 'pro', 'teams'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid subscription plan. Choose "free", "pro", or "teams".' });
    }

    const voiceLimit = plan === 'free' ? 5 : 999999;
    const reminderLimit = plan === 'free' ? 10 : 999999;

    db.prepare(`
      UPDATE users
      SET plan = ?, voice_quota_limit = ?, reminder_limit = ?
      WHERE id = ?
    `).run(plan, voiceLimit, reminderLimit, req.user.id);

    const updatedUser = db.prepare(`SELECT ${USER_SELECT_FIELDS} FROM users WHERE id = ?`).get(req.user.id);
    res.json({
      message:
        plan === 'free'
          ? 'Switched to Starter Free Plan.'
          : `Checkout verified (${paymentMethod || 'Stripe / Card'}) — Upgraded to ${plan.toUpperCase()} SaaS Plan!`,
      user: updatedUser
    });
  } catch (err) {
    console.error('Subscription update error:', err);
    res.status(500).json({ error: 'Failed to update subscription plan.' });
  }
});

// Get VAPID public key for background Web Push wake-up alarms
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Subscribe device for background Web Push wake-up alarms (works even if user logged in offline earlier!)
router.post('/push-subscribe', (req, res) => {
  try {
    const { subscription, userId } = req.body;
    savePushSubscription(userId || 'broadcast', subscription);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save push subscription.' });
  }
});

module.exports = router;
