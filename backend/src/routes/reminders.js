const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { parseReminderInput, getRepeatRuleMeta, applyQuietHours } = require('../services/aiParser');
const {
  parseWithGeminiAI,
  generateDailyBriefingWithGemini,
  runConversationalAssistantWithGemini
} = require('../services/geminiService');

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

// Preview AI Natural Language, Multimodal Voice & Vision Image Parse before saving
router.post('/parse', authenticateToken, async (req, res) => {
  try {
    const { text, audioBase64, audioMimeType, imageBase64, imageMimeType, referenceTime } = req.body;
    const refDate = referenceTime ? new Date(referenceTime) : new Date();
    const userApiKey = req.user?.gemini_api_key || process.env.GEMINI_API_KEY;

    // Use real Gemini 2.5 Flash LLM whenever audioBase64, imageBase64, or a Gemini API key is configured
    if (userApiKey || audioBase64 || imageBase64) {
      const parsed = await parseWithGeminiAI({
        rawText: text || '',
        audioBase64: audioBase64 || null,
        audioMimeType: audioMimeType || 'audio/webm',
        imageBase64: imageBase64 || null,
        imageMimeType: imageMimeType || 'image/jpeg',
        referenceDate: refDate,
        apiKey: userApiKey
      });
      return res.json({ parsed });
    }

    const parsed = parseReminderInput(text || '', refDate);
    res.json({ parsed: { ...parsed, aiEngine: 'local-nlp' } });
  } catch (err) {
    const refDate = req.body?.referenceTime ? new Date(req.body.referenceTime) : new Date();
    const parsed = parseReminderInput(req.body?.text || '', refDate);
    res.json({ parsed: { ...parsed, aiEngine: 'local-nlp' } });
  }
});

// Get AI Daily Briefing (Spoken Executive Digest)
router.get('/briefing', authenticateToken, async (req, res) => {
  try {
    const reminders = db.prepare(`
      SELECT * FROM reminders
      WHERE user_id = ? OR LOWER(assigned_to_email) = LOWER(?)
      ORDER BY scheduled_at ASC
    `).all(req.user.id, req.user.email);

    const statsRows = db.prepare(`
      SELECT action, COUNT(*) as count
      FROM reminder_logs
      WHERE user_id = ?
      GROUP BY action
    `).all(req.user.id);
    const stats = {};
    for (const r of statsRows) stats[r.action] = r.count;

    const userApiKey = req.user?.gemini_api_key || process.env.GEMINI_API_KEY;
    const result = await generateDailyBriefingWithGemini({
      user: req.user,
      reminders,
      stats,
      apiKey: userApiKey
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate AI briefing.' });
  }
});

// Conversational AI Assistant & Bulk Rescheduler ("Push all afternoon alarms back by 1 hour")
router.post('/assistant', authenticateToken, async (req, res) => {
  try {
    const { command, referenceTime } = req.body;
    if (!command || !command.trim()) {
      return res.status(400).json({ error: 'Please enter a command or question.' });
    }
    const refDate = referenceTime ? new Date(referenceTime) : new Date();
    const reminders = db.prepare(`
      SELECT * FROM reminders
      WHERE user_id = ? AND status IN ('pending', 'snoozed')
      ORDER BY scheduled_at ASC
    `).all(req.user.id);

    const userApiKey = req.user?.gemini_api_key || process.env.GEMINI_API_KEY;
    const result = await runConversationalAssistantWithGemini({
      command: command.trim(),
      reminders,
      referenceDate: refDate,
      apiKey: userApiKey
    });

    const nowIso = new Date().toISOString();
    let appliedCount = 0;

    if (Array.isArray(result.operations)) {
      for (const op of result.operations) {
        if (!op || !op.id) continue;
        const target = db.prepare('SELECT * FROM reminders WHERE id = ? AND user_id = ?').get(op.id, req.user.id);
        if (!target) continue;

        if (op.action === 'reschedule' && op.scheduledAt) {
          db.prepare('UPDATE reminders SET scheduled_at = ?, updated_at = ? WHERE id = ?').run(
            op.scheduledAt,
            nowIso,
            target.id
          );
          createLogEntry({
            reminderId: target.id,
            userId: req.user.id,
            reminderTitle: target.title,
            inputType: target.input_type,
            audioUrl: target.audio_url,
            action: 'snoozed',
            details: `Rescheduled by AI Assistant to ${new Date(op.scheduledAt).toLocaleString()}`
          });
          appliedCount++;
        } else if (op.action === 'complete') {
          db.prepare("UPDATE reminders SET status = 'completed', updated_at = ? WHERE id = ?").run(
            nowIso,
            target.id
          );
          createLogEntry({
            reminderId: target.id,
            userId: req.user.id,
            reminderTitle: target.title,
            inputType: target.input_type,
            audioUrl: target.audio_url,
            action: 'completed',
            details: 'Completed via AI Assistant command'
          });
          appliedCount++;
        } else if (op.action === 'delete') {
          db.prepare('DELETE FROM reminders WHERE id = ?').run(target.id);
          appliedCount++;
        }
      }
    }

    res.json({
      reply: result.reply,
      operationsCount: appliedCount
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to run AI assistant command.' });
  }
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
router.post('/', authenticateToken, upload.single('audio'), async (req, res) => {
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
    let imageUrl = null;
    let audioBase64ForAI = req.body.audioBase64 || null;
    let audioMimeTypeForAI = 'audio/webm';
    let imageBase64ForAI = req.body.imageBase64 || null;
    let imageMimeTypeForAI = req.body.imageMimeType || 'image/jpeg';
    const isPhoto = req.body.inputType === 'photo' || !!req.body.imageBase64;

    if (req.file) {
      audioUrl = `/uploads/${req.file.filename}`;
      try {
        const fileBuf = fs.readFileSync(req.file.path);
        audioBase64ForAI = fileBuf.toString('base64');
        audioMimeTypeForAI = req.file.mimetype || 'audio/mp4';
      } catch (e) {}
    } else if (req.body.audioBase64) {
      const commaIdx = req.body.audioBase64.indexOf(',');
      const base64Data = commaIdx !== -1 ? req.body.audioBase64.slice(commaIdx + 1) : req.body.audioBase64;
      const ext = req.body.audioExt || '.webm';
      audioMimeTypeForAI = ext === '.m4a' ? 'audio/mp4' : ext === '.wav' ? 'audio/wav' : 'audio/webm';
      const filename = `voice_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`;
      fs.writeFileSync(path.join(uploadsDir, filename), Buffer.from(base64Data, 'base64'));
      audioUrl = `/uploads/${filename}`;
    }

    if (req.body.imageBase64) {
      const commaIdx = req.body.imageBase64.indexOf(',');
      const base64Data = commaIdx !== -1 ? req.body.imageBase64.slice(commaIdx + 1) : req.body.imageBase64;
      const filename = `photo_${Date.now()}_${uuidv4().slice(0, 8)}.jpg`;
      fs.writeFileSync(path.join(uploadsDir, filename), Buffer.from(base64Data, 'base64'));
      imageUrl = `/uploads/${filename}`;
    }

    let rawInput = (req.body.rawInput || req.body.text || req.body.transcript || '').trim();
    const refDate = req.body.referenceTime ? new Date(req.body.referenceTime) : new Date();
    const userApiKey = user.gemini_api_key || process.env.GEMINI_API_KEY;

    // Run real Gemini 2.5 Flash AI when an API key is configured (including direct audio & photo vision understanding!)
    const aiParsed = userApiKey
      ? await parseWithGeminiAI({
          rawText: rawInput,
          audioBase64: isVoice ? audioBase64ForAI : null,
          audioMimeType: audioMimeTypeForAI,
          imageBase64: isPhoto ? imageBase64ForAI : null,
          imageMimeType: imageMimeTypeForAI,
          referenceDate: refDate,
          apiKey: userApiKey
        })
      : parseReminderInput(rawInput || (isVoice ? 'Voice Note Reminder' : isPhoto ? 'Photo Reminder' : 'Untitled Reminder'), refDate);

    if (!rawInput && aiParsed.transcript) {
      rawInput = aiParsed.transcript;
    } else if (!rawInput) {
      rawInput = isVoice ? 'Voice Note Reminder' : isPhoto ? 'Photo Vision Reminder' : 'Untitled Reminder';
    }

    const title = (req.body.title || '').trim() || aiParsed.title;
    let scheduledAt = req.body.scheduledAt || aiParsed.scheduledAt;
    const priority = req.body.priority || aiParsed.priority || 'medium';
    const category = req.body.category || aiParsed.category || 'general';
    const repeatRule = req.body.repeatRule || aiParsed.repeatRule || 'none';
    const alarmTone = req.body.alarmTone || user.alarm_tone || 'classic';
    const actionLink = req.body.actionLink !== undefined ? req.body.actionLink : (aiParsed.actionLink || '');
    const locationTrigger = req.body.locationTrigger !== undefined ? req.body.locationTrigger : (aiParsed.locationTrigger || '');
    const assignedToEmail = req.body.assignedToEmail !== undefined ? req.body.assignedToEmail : (aiParsed.assignedToEmail || '');
    const requireProof = req.body.requireProof !== undefined ? (req.body.requireProof ? 1 : 0) : (aiParsed.requireProof ? 1 : 0);
    const ttsEnabled = req.body.ttsEnabled !== undefined ? (req.body.ttsEnabled ? 1 : 0) : 1;
    const subtasksJson = Array.isArray(req.body.subtasks) && req.body.subtasks.length > 0
      ? JSON.stringify(req.body.subtasks)
      : Array.isArray(aiParsed.subtasks) && aiParsed.subtasks.length > 0
      ? JSON.stringify(aiParsed.subtasks)
      : (req.body.subtasksJson || '[]');
    const audioDuration = parseInt(req.body.audioDuration || '0', 10);

    // Support multiple daily time slots for the same activity (either from UI multiTimes array or AI parser)
    let rawMultiTimes = [];
    if (Array.isArray(req.body.multiTimes)) {
      rawMultiTimes = req.body.multiTimes;
    } else if (typeof req.body.multiTimes === 'string' && req.body.multiTimes.trim()) {
      try {
        rawMultiTimes = JSON.parse(req.body.multiTimes);
      } catch (e) {
        rawMultiTimes = req.body.multiTimes.split(',').map((s) => s.trim()).filter(Boolean);
      }
    } else if (Array.isArray(aiParsed.multiTimes) && aiParsed.multiTimes.length > 1) {
      rawMultiTimes = aiParsed.multiTimes;
    }

    // Build list of target schedule timestamps (1 for single alarm, N for multi-time daily schedule)
    const scheduleSlots = [];
    if (rawMultiTimes.length > 0) {
      for (const slot of rawMultiTimes) {
        const m = String(slot).trim().match(/^(\d{1,2})[:.](\d{2})(?:\s*(am|pm))?$/i);
        if (m) {
          let h = parseInt(m[1], 10);
          const mins = parseInt(m[2], 10);
          const mer = (m[3] || '').toLowerCase();
          if (mer === 'pm' && h < 12) h += 12;
          if (mer === 'am' && h === 12) h = 0;
          const d = new Date(refDate);
          d.setHours(h, mins, 0, 0);
          if (d.getTime() <= refDate.getTime()) {
            d.setDate(d.getDate() + 1);
          }
          scheduleSlots.push({
            iso: d.toISOString(),
            label: `${String(h).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
          });
        }
      }
    }

    if (scheduleSlots.length === 0) {
      scheduleSlots.push({ iso: scheduledAt, label: null });
    }

    const now = new Date().toISOString();
    const inputType = isVoice ? 'voice' : isPhoto ? 'photo' : 'text';
    const effectiveRepeat = scheduleSlots.length > 1 && repeatRule === 'none' ? 'daily' : repeatRule;
    const createdReminders = [];
    let anyQuietHoursAdjusted = false;

    const insertStmt = db.prepare(`
      INSERT INTO reminders (
        id, user_id, title, raw_input, input_type, audio_url, image_url, audio_duration,
        scheduled_at, status, priority, category, snooze_count, repeat_rule,
        action_link, location_trigger, subtasks_json, assigned_to_email,
        require_proof, tts_enabled, alarm_tone, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let idx = 0; idx < scheduleSlots.length; idx++) {
      let slotIso = scheduleSlots[idx].iso;
      const qh = applyQuietHours(new Date(slotIso), user);
      if (qh.wasAdjusted) {
        slotIso = qh.adjustedDate.toISOString();
        anyQuietHoursAdjusted = true;
      }

      const id = uuidv4();
      const slotTitle =
        scheduleSlots.length > 1 && scheduleSlots[idx].label
          ? `${title} (${scheduleSlots[idx].label})`
          : title;

      insertStmt.run(
        id, user.id, slotTitle, rawInput, inputType, audioUrl, imageUrl, audioDuration,
        slotIso, priority, category, effectiveRepeat,
        actionLink, locationTrigger, subtasksJson, assignedToEmail,
        requireProof, ttsEnabled, alarmTone, now, now
      );

      const extraNotes = [];
      if (scheduleSlots.length > 1) extraNotes.push(`Multi-Time Slot ${idx + 1}/${scheduleSlots.length}`);
      if (category && category !== 'general') extraNotes.push(`Category: ${category.toUpperCase()}`);
      if (effectiveRepeat && effectiveRepeat !== 'none') extraNotes.push(`Repeat: ${getRepeatRuleMeta(effectiveRepeat).label}`);
      if (locationTrigger) extraNotes.push(`GPS Trigger: ${locationTrigger}`);
      if (assignedToEmail) extraNotes.push(`Delegated to: ${assignedToEmail}`);

      createLogEntry({
        reminderId: id,
        userId: user.id,
        reminderTitle: slotTitle,
        inputType,
        audioUrl,
        action: 'created',
        details: `Scheduled for ${new Date(slotIso).toLocaleString()} via ${inputType.toUpperCase()}${extraNotes.length ? ' • ' + extraNotes.join(' | ') : ''}`
      });

      createdReminders.push(db.prepare('SELECT * FROM reminders WHERE id = ?').get(id));
    }

    if (isVoice) {
      db.prepare('UPDATE users SET voice_quota_used = voice_quota_used + 1 WHERE id = ?').run(user.id);
    }

    const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    delete updatedUser.password_hash;

    res.status(201).json({
      reminder: createdReminders[0],
      reminders: createdReminders,
      count: createdReminders.length,
      parsed: aiParsed,
      quietHoursAdjusted: anyQuietHoursAdjusted,
      user: updatedUser
    });
  } catch (err) {
    console.error('Create reminder error:', err);
    res.status(500).json({ error: 'Failed to create reminder.' });
  }
});

// Edit or quick-reschedule an existing reminder (Title, Time, Repeat, Category, Alarm Tone)
router.patch('/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const reminder = db.prepare('SELECT * FROM reminders WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found.' });
    }

    const {
      title,
      scheduledAt,
      shiftMinutes,
      repeatRule,
      category,
      priority,
      alarmTone
    } = req.body;

    let nextScheduled = scheduledAt || reminder.scheduled_at;
    if (shiftMinutes !== undefined && Number(shiftMinutes) !== 0) {
      const base = Math.max(Date.now(), new Date(reminder.scheduled_at).getTime());
      nextScheduled = new Date(base + Number(shiftMinutes) * 60000).toISOString();
    }

    const nextTitle = title !== undefined && title.trim() ? title.trim() : reminder.title;
    const nextRepeat = repeatRule !== undefined ? repeatRule : reminder.repeat_rule;
    const nextCategory = category !== undefined ? category : reminder.category;
    const nextPriority = priority !== undefined ? priority : reminder.priority;
    const nextTone = alarmTone !== undefined ? alarmTone : (reminder.alarm_tone || 'classic');
    const nowIso = new Date().toISOString();

    db.prepare(`
      UPDATE reminders
      SET title = ?, scheduled_at = ?, status = 'pending', repeat_rule = ?,
          category = ?, priority = ?, alarm_tone = ?, push_sent_at = '', updated_at = ?
      WHERE id = ?
    `).run(
      nextTitle,
      nextScheduled,
      nextRepeat,
      nextCategory,
      nextPriority,
      nextTone,
      nowIso,
      id
    );

    createLogEntry({
      reminderId: id,
      userId: req.user.id,
      reminderTitle: nextTitle,
      inputType: reminder.input_type,
      audioUrl: reminder.audio_url,
      action: 'created',
      details: `Updated / Rescheduled for ${new Date(nextScheduled).toLocaleString()}`
    });

    const updated = db.prepare('SELECT * FROM reminders WHERE id = ?').get(id);
    res.json({ reminder: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update reminder.' });
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
