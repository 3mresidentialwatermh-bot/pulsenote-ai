const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get activity & audit logs + analytics breakdown for the authenticated user
router.get('/', authenticateToken, (req, res) => {
  try {
    const { action, inputType, limit = 100 } = req.query;

    let query = 'SELECT * FROM reminder_logs WHERE user_id = ?';
    const params = [req.user.id];

    if (action && action !== 'all') {
      query += ' AND action = ?';
      params.push(action);
    }

    if (inputType && inputType !== 'all') {
      query += ' AND input_type = ?';
      params.push(inputType);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(parseInt(limit, 10) || 100);

    const logs = db.prepare(query).all(...params);

    const statsRows = db.prepare(`
      SELECT action, COUNT(*) as count
      FROM reminder_logs
      WHERE user_id = ?
      GROUP BY action
    `).all(req.user.id);

    const stats = {
      created: 0,
      triggered: 0,
      snoozed: 0,
      completed: 0,
      missed: 0,
      deleted: 0
    };

    for (const row of statsRows) {
      if (stats[row.action] !== undefined) {
        stats[row.action] = row.count;
      }
    }

    // Category distribution
    const categoryRows = db.prepare(`
      SELECT category, COUNT(*) as count
      FROM reminders
      WHERE user_id = ?
      GROUP BY category
    `).all(req.user.id);

    // Most snoozed tasks
    const mostSnoozed = db.prepare(`
      SELECT id, title, snooze_count, category
      FROM reminders
      WHERE user_id = ? AND snooze_count > 0
      ORDER BY snooze_count DESC
      LIMIT 5
    `).all(req.user.id);

    const totalFinished = stats.completed + stats.missed;
    const completionRate = totalFinished > 0
      ? Math.round((stats.completed / totalFinished) * 100)
      : 100;

    res.json({
      logs,
      stats,
      analytics: {
        completionRate,
        streakDays: req.user.streak_days || 1,
        categories: categoryRows,
        mostSnoozed
      }
    });
  } catch (err) {
    console.error('Fetch logs error:', err);
    res.status(500).json({ error: 'Failed to retrieve activity logs.' });
  }
});

// Export Audit Logs as CSV
router.get('/export.csv', authenticateToken, (req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM reminder_logs WHERE user_id = ? ORDER BY timestamp DESC').all(req.user.id);
    const header = 'ID,Timestamp,Action,InputType,ReminderTitle,Details\n';
    const rows = logs.map((l) => {
      const safeTitle = `"${(l.reminder_title || '').replace(/"/g, '""')}"`;
      const safeDetails = `"${(l.details || '').replace(/"/g, '""')}"`;
      return `${l.id},${l.timestamp},${l.action},${l.input_type},${safeTitle},${safeDetails}`;
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="pulsenote_audit_logs.csv"');
    res.send(header + rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export CSV.' });
  }
});

module.exports = router;
