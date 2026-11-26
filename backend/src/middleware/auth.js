const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-reminder-saas-key-2026';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const stmt = db.prepare(`
      SELECT id, name, email, plan, voice_quota_used, voice_quota_limit, reminder_limit,
             quiet_hours_enabled, quiet_hours_start, quiet_hours_end,
             escalation_whatsapp, escalation_sms, escalation_email, phone_number,
             streak_days, gemini_api_key, alarm_tone, created_at
      FROM users WHERE id = ?
    `);
    const user = stmt.get(decoded.userId);

    if (!user) {
      return res.status(401).json({ error: 'User account not found.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
}

module.exports = { authenticateToken, JWT_SECRET };
