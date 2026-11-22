const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { parseReminderInput, getRepeatRuleMeta, applyQuietHours } = require('../services/aiParser');

const router = express.Router();

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.m4a';
    cb(null, `voice_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }
});

function createLogEntry({ reminderId, userId, reminderTitle, inputType, audioUrl, action, details }) {
  const logId = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO reminder_logs (id, reminder_id, user_id, reminder_title, input_type, audio_url, action, details, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(logId, reminderId, userId, reminderTitle, inputType || 'text', audioUrl || null, action, details || '', now);
}

// Preview AI Natural Language Parse before saving
router.post('/parse', authenticateToken, (req, res) => {
  const { text, referenceTime } = req.body;
  const refDate = referenceTime ? new Date(referenceTime) : new Date();
  const parsed = parseReminderInput(text || '', refDate);
  res.json({ parsed });
});

// Get all reminders for logged-in user (including delegated reminders assigned to their email)
router.get('/', authenticateToken, (req, res) => {
  const reminders = db.prepare(`
    SELECT * FROM reminders
    WHERE user_id = ? OR LOWER(assigned_to_email) = LOWER(?)
    ORDER BY
      CASE WHEN status IN ('pending', 'snoozed') THEN 0 ELSE 1 END,
      scheduled_at ASC
  `).all(req.user.id, req.user.email);

  res.json({ reminders });
});

// Create a reminder (supports both JSON text input and multipart/form-data voice note upload)
router.post('/', authenticateToken, upload.single('audio'), (req, res) => {
  try {
    const user = req.user;
    const isVoice = req.body.inputType === 'voice' || !!req.file || !!req.body.audioBase64;

    const activeCountRow = db.prepare(
      "SELECT COUNT(*) as count FROM reminders WHERE user_id = ? AND status IN ('pending', 'snoozed')"
    ).get(user.id);
    const activeCount = activeCountRow ? activeCountRow.count : 0;

    if (user.plan === 'free' && activeCount >= user.reminder_limit) {
      return res.status(403).json({
        error: `Free Plan limit reached (${user.reminder_limit} active reminders). Upgrade to Pro for unlimited reminders!`,
        code: 'QUOTA_EXCEEDED'
      });
    }

    if (isVoice && user.plan === 'free' && user.voice_quota_used >= user.voice_quota_limit) {
      return res.status(403).json({
        error: `Free Plan voice note limit reached (${user.voice_quota_limit}/month). Upgrade to Pro for unlimited AI voice reminders!`,
        code: 'VOICE_QUOTA_EXCEEDED'
      });
    }

    let audioUrl = null;
    if (req.file) {
      audioUrl = `/uploads/${req.file.filename}`;
    } else if (req.body.audioBase64) {
      const matches = req.body.audioBase64.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
      const base64Data = matches ? matches[2] : req.body.audioBase64;
      const ext = req.body.audioExt || '.wav';
      const filename = `voice_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`;
      fs.writeFileSync(path.join(uploadsDir, filename), Buffer.from(base64Data, 'base64'));
      audioUrl = `/uploads/${filename}`;
    }

    const rawInput = (req.body.rawInput || req.body.text || req.body.transcript || '').trim() ||
      (isVoice ? 'Voice Note Reminder' : 'Untitled Reminder');

    const refDate = req.body.referenceTime ? new Date(req.body.referenceTime) : new Date();
    const aiParsed = parseReminderInput(rawInput, refDate);

    const title = (req.body.title || '').trim() || aiParsed.title;
    let scheduledAt = req.body.scheduledAt || aiParsed.scheduledAt;
    const priority = req.body.priority || aiParsed.priority || 'medium';
    const category = req.body.category || aiParsed.category || 'general';
    const repeatRule = req.body.repeatRule || aiParsed.repeatRule || 'none';
    const actionLink = req.body.actionLink !== undefined ? req.body.actionLink : (aiParsed.actionLink || '');
    const locationTrigger = req.body.locationTrigger !== undefined ? req.body.locationTrigger : (aiParsed.locationTrigger || '');
    const assignedToEmail = req.body.assignedToEmail !== undefined ? req.body.assignedToEmail : (aiParsed.assignedToEmail || '');
    const requireProof = req.body.requireProof !== undefined ? (req.body.requireProof ? 1 : 0) : (aiParsed.requireProof ? 1 : 0);
    const ttsEnabled = req.body.ttsEnabled !== undefined ? (req.body.ttsEnabled ? 1 : 0) : 1;
    const subtasksJson = Array.isArray(req.body.subtasks)
      ? JSON.stringify(req.body.subtasks)
      : (req.body.subtasksJson || '[]');
    const audioDuration = parseInt(req.body.audioDuration || '0', 10);

    // Apply Quiet Hours adjustment if enabled on user profile
    const qh = applyQuietHours(new Date(scheduledAt), user);
    if (qh.wasAdjusted) {
      scheduledAt = qh.adjustedDate.toISOString();
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const inputType = isVoice ? 'voice' : 'text';

    db.prepare(`
      INSERT INTO reminders (
        id, user_id, title, raw_input, input_type, audio_url, audio_duration,
        scheduled_at, status, priority, category, snooze_count, repeat_rule,
        action_link, location_trigger, subtasks_json, assigned_to_email,
        require_proof, tts_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, user.id, title, rawInput, inputType, audioUrl, audioDuration,
      scheduledAt, priority, category, repeatRule,
      actionLink, locationTrigger, subtasksJson, assignedToEmail,
      requireProof, ttsEnabled, now, now
    );

    if (isVoice) {
      db.prepare('UPDATE users SET voice_quota_used = voice_quota_used + 1 WHERE id = ?').run(user.id);
    }

    const extraNotes = [];
    if (category && category !== 'general') extraNotes.push(`Category: ${category.toUpperCase()}`);
    if (repeatRule && repeatRule !== 'none') extraNotes.push(`Repeat: ${getRepeatRuleMeta(repeatRule).label}`);
    if (locationTrigger) extraNotes.push(`GPS Trigger: ${locationTrigger}`);
    if (assignedToEmail) extraNotes.push(`Delegated to: ${assignedToEmail}`);
    if (qh.wasAdjusted) extraNotes.push(`Adjusted for Quiet Hours (${user.quiet_hours_start}-${user.quiet_hours_end})`);

    createLogEntry({
      reminderId: id,
      userId: user.id,
      reminderTitle: title,
      inputType,
      audioUrl,
      action: 'created',
      details: `Scheduled for ${new Date(scheduledAt).toLocaleString()} via ${inputType.toUpperCase()}${extraNotes.length ? ' • ' + extraNotes.join(' | ') : ''}`
    });

    const created = db.prepare('SELECT * FROM reminders WHERE id = ?').get(id);
    const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    delete updatedUser.password_hash;

    res.status(201).json({
      reminder: created,
      parsed: aiParsed,
      quietHoursAdjusted: qh.wasAdjusted,
      user: updatedUser
    });
  } catch (err) {
    console.error('Create reminder error:', err);
    res.status(500).json({ error: 'Failed to create reminder.' });
  }
});

// Toggle a subtask checkbox inside a reminder
router.patch('/:id/subtasks', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { subtasks } = req.body;
    const reminder = db.prepare('SELECT * FROM reminders WHERE id = ?').get(id);
    if (!reminder) return res.status(404).json({ error: 'Reminder not found.' });

    db.prepare('UPDATE reminders SET subtasks_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(subtasks || []),
      new Date().toISOString(),
      id
    );
    const updated = db.prepare('SELECT * FROM reminders WHERE id = ?').get(id);
    res.json({ reminder: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update subtasks.' });
  }
});

// Trigger, Snooze, Complete, or Miss a reminder
router.patch('/:id/action', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { action, snoozeMinutes = 5 } = req.body;

    const reminder = db.prepare('SELECT * FROM reminders WHERE id = ?').get(id);
    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found.' });
    }

    const now = new Date();
    const nowIso = now.toISOString();

    if (action === 'triggered') {
      createLogEntry({
        reminderId: reminder.id,
        userId: req.user.id,
        reminderTitle: reminder.title,
        inputType: reminder.input_type,
        audioUrl: reminder.audio_url,
        action: 'triggered',
        details: `Alarm rang on device${reminder.tts_enabled ? ' + Spoken TTS Readout' : ''}`
      });
      return res.json({ reminder });
    }

    if (action === 'snooze') {
      const mins = parseInt(snoozeMinutes, 10) || 5;
      const newScheduledAt = new Date(now.getTime() + mins * 60 * 1000).toISOString();
      const newSnoozeCount = reminder.snooze_count + 1;

      db.prepare(`
        UPDATE reminders
        SET status = 'snoozed', scheduled_at = ?, snooze_count = ?, updated_at = ?
        WHERE id = ?
      `).run(newScheduledAt, newSnoozeCount, nowIso, reminder.id);

      createLogEntry({
        reminderId: reminder.id,
        userId: req.user.id,
        reminderTitle: reminder.title,
        inputType: reminder.input_type,
        audioUrl: reminder.audio_url,
        action: 'snoozed',
        details: `Snoozed for ${mins} minute(s) (Snooze #${newSnoozeCount}) -> Next alarm at ${new Date(newScheduledAt).toLocaleTimeString()}`
      });
    } else if (action === 'complete') {
      // Increment user's streak counter on task completion
      db.prepare('UPDATE users SET streak_days = streak_days + 1 WHERE id = ?').run(req.user.id);

      const repeatMeta = getRepeatRuleMeta(reminder.repeat_rule);
      if (repeatMeta.isRecurring && repeatMeta.intervalMs > 0) {
        const baseTime = Math.max(now.getTime(), new Date(reminder.scheduled_at).getTime());
        let nextDate = new Date(baseTime + repeatMeta.intervalMs);
        const qh = applyQuietHours(nextDate, req.user);
        if (qh.wasAdjusted) nextDate = qh.adjustedDate;
        const nextScheduled = nextDate.toISOString();

        db.prepare(`
          UPDATE reminders
          SET status = 'pending', scheduled_at = ?, snooze_count = 0, updated_at = ?
          WHERE id = ?
        `).run(nextScheduled, nowIso, reminder.id);

        createLogEntry({
          reminderId: reminder.id,
          userId: req.user.id,
          reminderTitle: reminder.title,
          inputType: reminder.input_type,
          audioUrl: reminder.audio_url,
          action: 'completed',
          details: `Completed cycle! Recurring (${repeatMeta.label}) automatically rescheduled for ${new Date(nextScheduled).toLocaleString()}${qh.wasAdjusted ? ' (Quiet Hours applied)' : ''}`
        });
      } else {
        db.prepare(`
          UPDATE reminders
          SET status = 'completed', updated_at = ?
          WHERE id = ?
        `).run(nowIso, reminder.id);

        createLogEntry({
          reminderId: reminder.id,
          userId: req.user.id,
          reminderTitle: reminder.title,
          inputType: reminder.input_type,
          audioUrl: reminder.audio_url,
          action: 'completed',
          details: `Task marked as completed${reminder.assigned_to_email ? ` (Shared with ${reminder.assigned_to_email})` : ''}`
        });
      }
    } else if (action === 'missed') {
      db.prepare(`
        UPDATE reminders
        SET status = 'missed', updated_at = ?
        WHERE id = ?
      `).run(nowIso, reminder.id);

      // Multi-channel Escalation dispatch (WhatsApp / SMS / Email)
      const channels = [];
      if (req.user.escalation_whatsapp) channels.push('WhatsApp');
      if (req.user.escalation_sms) channels.push('SMS');
      if (req.user.escalation_email) channels.push(`Email (${req.user.email})`);
      if (reminder.assigned_to_email) channels.push(`Assignee (${reminder.assigned_to_email})`);

      const escalationMsg = channels.length > 0
        ? ` • Escalation alerts dispatched via: ${channels.join(', ')}`
        : '';

      createLogEntry({
        reminderId: reminder.id,
        userId: req.user.id,
        reminderTitle: reminder.title,
        inputType: reminder.input_type,
        audioUrl: reminder.audio_url,
        action: 'missed',
        details: `Alarm went unanswered past grace window${escalationMsg}`
      });
    } else {
      return res.status(400).json({ error: 'Invalid action. Use triggered, snooze, complete, or missed.' });
    }

    const updated = db.prepare('SELECT * FROM reminders WHERE id = ?').get(reminder.id);
    res.json({ reminder: updated });
  } catch (err) {
    console.error('Reminder action error:', err);
    res.status(500).json({ error: 'Failed to update reminder status.' });
  }
});

// Delete a reminder
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const reminder = db.prepare('SELECT * FROM reminders WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found.' });
    }

    db.prepare('DELETE FROM reminders WHERE id = ?').run(id);

    createLogEntry({
      reminderId: reminder.id,
      userId: req.user.id,
      reminderTitle: reminder.title,
      inputType: reminder.input_type,
      audioUrl: reminder.audio_url,
      action: 'deleted',
      details: 'Reminder deleted by user'
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Delete reminder error:', err);
    res.status(500).json({ error: 'Failed to delete reminder.' });
  }
});

module.exports = router;
