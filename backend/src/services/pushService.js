const webpush = require('web-push');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ||
  'BCftqyNrZZD2aXsdFpV7NxRQfpHgY0u37D6Onha9s8dkzW0_rvKuKIX2CnogG4qEBT6hy0wPVYreBX694nipIUU';
const VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY ||
  'eGRC4Bqx744QMXiDYBJ_-qbpgRKQ3MV7yblb2EXTWxc';

webpush.setVapidDetails(
  'mailto:support@pulsenote.ai',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

function savePushSubscription(userId, subscription) {
  if (!subscription || !subscription.endpoint) return;
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?')
    .get(subscription.endpoint);

  if (existing) {
    db.prepare(
      'UPDATE push_subscriptions SET user_id = ?, subscription_json = ?, created_at = ? WHERE id = ?'
    ).run(userId, JSON.stringify(subscription), now, existing.id);
  } else {
    db.prepare(
      'INSERT INTO push_subscriptions (id, user_id, endpoint, subscription_json, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(uuidv4(), userId, subscription.endpoint, JSON.stringify(subscription), now);
  }
}

async function dispatchPushForReminder(reminder) {
  let subs = db
    .prepare('SELECT * FROM push_subscriptions WHERE user_id = ?')
    .all(reminder.user_id);

  // Fallback to all registered device subscriptions if the device subscribed while in offline-token mode
  if (!subs || subs.length === 0) {
    subs = db.prepare('SELECT * FROM push_subscriptions').all();
  }

  if (!subs || subs.length === 0) return;

  const payload = JSON.stringify({
    title: `⏰ PulseNote Alarm: ${reminder.title}`,
    body: reminder.raw_input || 'Time to complete your scheduled task!',
    reminderId: reminder.id,
    scheduledAt: reminder.scheduled_at,
    category: reminder.category || 'general',
    priority: reminder.priority || 'medium',
    audioUrl: reminder.audio_url || null
  });

  for (const row of subs) {
    try {
      const subObj = JSON.parse(row.subscription_json);
      await webpush.sendNotification(subObj, payload, {
        TTL: 3600,
        urgency: 'high'
      });
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(row.id);
      }
    }
  }
}

function startBackgroundPushCron() {
  setInterval(async () => {
    try {
      const nowIso = new Date().toISOString();
      // Find pending/snoozed reminders whose scheduled_at has arrived and haven't had a push sent for this exact scheduled_at
      const dueReminders = db
        .prepare(`
          SELECT * FROM reminders
          WHERE status IN ('pending', 'snoozed')
            AND scheduled_at <= ?
            AND (push_sent_at IS NULL OR push_sent_at != scheduled_at)
        `)
        .all(nowIso);

      for (const rem of dueReminders) {
        db.prepare('UPDATE reminders SET push_sent_at = ? WHERE id = ?').run(
          rem.scheduled_at,
          rem.id
        );
        await dispatchPushForReminder(rem);
      }
    } catch (err) {
      console.warn('Push cron error:', err.message);
    }
  }, 3000);
}

module.exports = {
  VAPID_PUBLIC_KEY,
  savePushSubscription,
  dispatchPushForReminder,
  startBackgroundPushCron
};
