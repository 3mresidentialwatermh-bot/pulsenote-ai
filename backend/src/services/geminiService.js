const { parseReminderInput, getRepeatRuleMeta } = require('./aiParser');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function getEffectiveApiKey(apiKey) {
  return (apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

/**
 * Calls Google Gemini 2.5 Flash REST API (Multimodal: supports raw text, recorded voice-note audio, AND photos/images!)
 */
async function parseWithGeminiAI({
  rawText = '',
  audioBase64 = null,
  audioMimeType = 'audio/webm',
  imageBase64 = null,
  imageMimeType = 'image/jpeg',
  referenceDate = new Date(),
  apiKey = null
}) {
  const effectiveKey = getEffectiveApiKey(apiKey);

  if (!effectiveKey) {
    const fallback = parseReminderInput(rawText, referenceDate);
    return { ...fallback, aiEngine: 'rule-based-fallback', transcript: rawText };
  }

  try {
    const refIso = referenceDate.toISOString();
    const refLocal = referenceDate.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    const tzOffsetMins = -referenceDate.getTimezoneOffset();
    const tzSign = tzOffsetMins >= 0 ? '+' : '-';
    const tzH = String(Math.floor(Math.abs(tzOffsetMins) / 60)).padStart(2, '0');
    const tzM = String(Math.abs(tzOffsetMins) % 60).padStart(2, '0');
    const tzString = `UTC${tzSign}${tzH}:${tzM}`;

    const systemInstruction = `You are the core AI engine for PulseNote AI, a smart voice-note, photo-vision, and text reminder app.
Current User Local Date/Time: ${refLocal} (${tzString}, ISO: ${refIso}).

Your job:
1. If an audio voice note is attached, transcribe what the user said accurately (supporting English, Hindi, Hinglish, Marathi, or any spoken language, translated into a clear actionable task title).
2. If an image/photo (such as a doctor's prescription, medicine strip, utility bill, handwritten sticky note, or meeting whiteboard) is attached, read the image via OCR/Vision, summarize what you found in "transcript", and extract the exact reminder schedule, medicine dosages, or bill due dates!
3. Extract the exact reminder schedule and structured fields:
   - If the user says "I have a meeting at 4 PM, remind me 45 minutes before", calculate 3:15 PM today.
   - If the user says "alarm by 7.30" or "wake me up at 7 30" without AM/PM, pick the next upcoming 7:30 (${tzString}).
   - If the user or prescription wants the SAME activity multiple times a day (e.g., "Take medicine 3 times a day", "1-1-1", "TDS", "BD", "at 9 AM, 2 PM and 8 PM"), populate "multiTimes" with 24-hour "HH:MM" strings (e.g. ["09:00", "14:00", "20:00"]) and set "repeatRule" to "daily".
   - If the user wants a repeating interval (e.g. "every 3 hours", "every 30 minutes"), set "repeatRule" to "every_<N>_<seconds|minutes|hours|days|weeks>" (e.g. "every_3_hours"). Otherwise use "none", "daily", or "weekly".
   - If the user or image mentions sub-steps or multiple items, populate "subtasks" as an array of strings.

Return ONLY valid JSON matching this exact schema:
{
  "transcript": "Full transcribed text of the voice note, or OCR summary of the photo/prescription/bill, or user text",
  "title": "Clean, concise actionable task title (e.g. 'Take Amoxicillin 500mg' or 'Pay Electricity Bill')",
  "scheduledAt": "ISO 8601 timestamp string for the first upcoming alarm trigger",
  "multiTimes": ["HH:MM"],
  "repeatRule": "none | daily | weekly | every_3_hours | every_30_minutes | ...",
  "priority": "low | medium | high",
  "category": "health | work | finance | personal | general",
  "actionLink": "optional tel:+123... or https://... if mentioned, else empty string",
  "locationTrigger": "optional place/location name if geofence mentioned, else empty string",
  "assignedToEmail": "optional email if delegated, else empty string",
  "requireProof": false,
  "subtasks": ["optional step 1", "optional step 2"],
  "parsedTimeText": "Human-friendly summary of the schedule, e.g. 'Today at 7:30 PM' or '3x Daily (09:00, 14:00, 20:00)'"
}`;

    const parts = [];
    if (audioBase64) {
      const commaIdx = audioBase64.indexOf(',');
      const cleanBase64 = commaIdx !== -1 ? audioBase64.slice(commaIdx + 1) : audioBase64;
      let detectedMime = audioMimeType || 'audio/webm';
      if (commaIdx !== -1) {
        const header = audioBase64.slice(0, commaIdx);
        const mimeMatch = header.match(/^data:([^;]+)/);
        if (mimeMatch && mimeMatch[1]) detectedMime = mimeMatch[1];
      }
      parts.push({
        inlineData: {
          mimeType: detectedMime,
          data: cleanBase64
        }
      });
    }

    if (imageBase64) {
      const commaIdx = imageBase64.indexOf(',');
      const cleanBase64 = commaIdx !== -1 ? imageBase64.slice(commaIdx + 1) : imageBase64;
      let detectedMime = imageMimeType || 'image/jpeg';
      if (commaIdx !== -1) {
        const header = imageBase64.slice(0, commaIdx);
        const mimeMatch = header.match(/^data:([^;]+)/);
        if (mimeMatch && mimeMatch[1]) detectedMime = mimeMatch[1];
      }
      parts.push({
        inlineData: {
          mimeType: detectedMime,
          data: cleanBase64
        }
      });
    }

    parts.push({
      text: rawText
        ? `User input / note: "${rawText}"\nExtract the reminder JSON.`
        : imageBase64
        ? 'Analyze this attached image (prescription, bill, note, or schedule) and extract the reminder JSON.'
        : 'Listen to this recorded voice note, transcribe it, and extract the reminder JSON.'
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(effectiveKey)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      const fallback = parseReminderInput(rawText, referenceDate);
      return {
        ...fallback,
        aiEngine: 'rule-based-fallback',
        aiError: `Gemini API HTTP ${response.status}`,
        transcript: rawText
      };
    }

    const resultJson = await response.json();
    const candidateText =
      resultJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const parsedObj = JSON.parse(candidateText);

    const repeatRule = parsedObj.repeatRule || 'none';
    const repeatMeta = getRepeatRuleMeta(repeatRule);
    const multiTimes = Array.isArray(parsedObj.multiTimes) && parsedObj.multiTimes.length > 1
      ? parsedObj.multiTimes
      : [];

    let scheduledDate = parsedObj.scheduledAt ? new Date(parsedObj.scheduledAt) : null;
    if (!scheduledDate || isNaN(scheduledDate.getTime())) {
      scheduledDate = new Date(referenceDate.getTime() + 60 * 1000);
    }

    return {
      transcript: parsedObj.transcript || rawText || parsedObj.title || 'Smart AI Reminder',
      title: parsedObj.title || 'Smart AI Reminder',
      scheduledAt: scheduledDate.toISOString(),
      multiTimes,
      priority: ['low', 'medium', 'high'].includes(parsedObj.priority) ? parsedObj.priority : 'medium',
      category: ['health', 'work', 'finance', 'personal', 'general'].includes(parsedObj.category)
        ? parsedObj.category
        : 'general',
      repeatRule,
      repeatLabel:
        multiTimes.length > 1
          ? `${multiTimes.length}x Daily (${multiTimes.join(', ')})`
          : repeatMeta.label,
      actionLink: parsedObj.actionLink || '',
      locationTrigger: parsedObj.locationTrigger || '',
      assignedToEmail: parsedObj.assignedToEmail || '',
      requireProof: !!parsedObj.requireProof || parsedObj.priority === 'high',
      subtasks: Array.isArray(parsedObj.subtasks)
        ? parsedObj.subtasks.map((s) => (typeof s === 'string' ? { text: s, done: false } : s))
        : [],
      parsedTimeText: parsedObj.parsedTimeText || repeatMeta.label,
      aiEngine: `gemini (${GEMINI_MODEL})`
    };
  } catch (err) {
    const fallback = parseReminderInput(rawText, referenceDate);
    return {
      ...fallback,
      aiEngine: 'rule-based-fallback',
      transcript: rawText
    };
  }
}

/**
 * Generates an executive AI Daily Briefing & spoken script summarizing the user's upcoming alarms,
 * completed tasks, and habit streak.
 */
async function generateDailyBriefingWithGemini({ user, reminders, stats, apiKey = null }) {
  const effectiveKey = getEffectiveApiKey(apiKey);
  const pending = reminders.filter((r) => r.status === 'pending' || r.status === 'snoozed');
  const completedCount = stats?.completed || 0;
  const firstName = (user?.name || 'there').split(' ')[0];

  const defaultSummary = pending.length === 0
    ? `Hey ${firstName}! You have a clear schedule right now with 0 pending alarms and ${completedCount} completed tasks on a ${user?.streak_days || 1}-day streak.`
    : `Hey ${firstName}! You have ${pending.length} active reminder${pending.length > 1 ? 's' : ''} lined up. Coming up next is "${pending[0].title}" at ${new Date(pending[0].scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. You're on a ${user?.streak_days || 1}-day streak with ${completedCount} tasks completed!`;

  if (!effectiveKey) {
    return { briefing: defaultSummary, aiEngine: 'local' };
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(effectiveKey)}`;
    const taskListText = pending
      .slice(0, 8)
      .map((r, i) => `${i + 1}. "${r.title}" (${r.category || 'general'}) at ${new Date(r.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} [Repeat: ${r.repeat_rule || 'none'}]`)
      .join('\n');

    const prompt = `You are PulseNote AI, a warm, energetic executive assistant for ${user?.name || 'the user'}.
Write a concise, natural 2-to-3 sentence spoken daily briefing (max 55 words) that can be read out loud via Text-to-Speech.
Facts:
- User Streak: ${user?.streak_days || 1} days
- Completed tasks so far: ${completedCount}
- Active upcoming alarms (${pending.length}):
${taskListText || 'None scheduled yet.'}

Return ONLY valid JSON: { "briefing": "Your spoken briefing text here" }`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, responseMimeType: 'application/json' }
      })
    });

    if (!response.ok) return { briefing: defaultSummary, aiEngine: 'local' };
    const data = await response.json();
    const parsed = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
    return {
      briefing: parsed.briefing || defaultSummary,
      aiEngine: `gemini (${GEMINI_MODEL})`
    };
  } catch (e) {
    return { briefing: defaultSummary, aiEngine: 'local' };
  }
}

/**
 * Conversational AI Assistant that can answer questions about the user's schedule OR execute bulk actions
 * (e.g. "Push all my alarms back by 1 hour", "Snooze everything by 30 minutes", "Complete all health tasks").
 */
async function runConversationalAssistantWithGemini({ command, reminders, referenceDate = new Date(), apiKey = null }) {
  const effectiveKey = getEffectiveApiKey(apiKey);
  const pending = reminders.filter((r) => r.status === 'pending' || r.status === 'snoozed');

  // Local fast handling if no key or simple command
  const shiftMatch = command.match(/\b(?:push|shift|delay|move|snooze)\b.*?\b(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/i);
  if (!effectiveKey) {
    if (shiftMatch) {
      const count = parseInt(shiftMatch[1], 10);
      const isHours = shiftMatch[2].toLowerCase().startsWith('h');
      const offsetMs = count * (isHours ? 3600000 : 60000);
      return {
        reply: `Shifted ${pending.length} active reminder(s) forward by ${count} ${isHours ? 'hour(s)' : 'minute(s)'}.`,
        operations: pending.map((r) => ({
          action: 'reschedule',
          id: r.id,
          scheduledAt: new Date(new Date(r.scheduled_at).getTime() + offsetMs).toISOString()
        }))
      };
    }
    return {
      reply: `You currently have ${pending.length} active alarm(s). Try saying "Push all alarms back by 30 minutes" or "Delay all reminders by 1 hour".`,
      operations: []
    };
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(effectiveKey)}`;
    const remindersDigest = pending.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      scheduled_at: r.scheduled_at,
      local_time: new Date(r.scheduled_at).toLocaleString()
    }));

    const sysPrompt = `You are PulseNote AI Assistant. Current time: ${referenceDate.toISOString()} (${referenceDate.toLocaleString()}).
Here are the user's active reminders:
${JSON.stringify(remindersDigest, null, 2)}

The user issued this command or question: "${command}"

Decide what operations (if any) to perform on the reminders, and write a helpful, concise 1-2 sentence reply.
Supported operation objects inside "operations" array:
1. { "action": "reschedule", "id": "<reminder_id>", "scheduledAt": "<new_ISO_8601_timestamp>" }
2. { "action": "complete", "id": "<reminder_id>" }
3. { "action": "delete", "id": "<reminder_id>" }

Return ONLY valid JSON:
{
  "reply": "Friendly confirmation or answer to the user's question",
  "operations": []
}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: sysPrompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
      })
    });

    if (!response.ok) {
      return { reply: 'Could not reach Gemini AI right now.', operations: [] };
    }

    const resData = await response.json();
    const parsed = JSON.parse(resData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
    return {
      reply: parsed.reply || 'Done!',
      operations: Array.isArray(parsed.operations) ? parsed.operations : []
    };
  } catch (e) {
    return { reply: 'Processed request.', operations: [] };
  }
}

module.exports = {
  parseWithGeminiAI,
  generateDailyBriefingWithGemini,
  runConversationalAssistantWithGemini
};
