const { parseReminderInput, getRepeatRuleMeta } = require('./aiParser');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

/**
 * Calls Google Gemini 2.5 Flash REST API (Multimodal: supports both raw text and recorded voice note audio bytes!)
 * Understands English, Indian English accents, Hindi, Hinglish, Marathi, complex relative reasoning
 * ("my flight is at 9 PM tomorrow so remind me 3 hours before that"), and multi-time schedules.
 */
async function parseWithGeminiAI({
  rawText = '',
  audioBase64 = null,
  audioMimeType = 'audio/webm',
  referenceDate = new Date(),
  apiKey = null
}) {
  const effectiveKey =
    (apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();

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

    const systemInstruction = `You are the core AI engine for PulseNote AI, a smart voice-note and text reminder app.
Current User Local Date/Time: ${refLocal} (${tzString}, ISO: ${refIso}).

Your job:
1. If an audio voice note is attached, transcribe what the user said accurately (supporting English, Hindi, Hinglish, Marathi, or any spoken language, translated into a clear actionable task title).
2. Extract the exact reminder schedule and structured fields from the user's voice note and/or text.
3. Complex Reasoning:
   - If the user says "I have a meeting at 4 PM, remind me 45 minutes before", calculate 3:15 PM today.
   - If the user says "alarm by 7.30" or "wake me up at 7 30" without AM/PM, pick the next upcoming 7:30 (${tzString}).
   - If the user wants the SAME activity multiple times a day (e.g., "Take medicine 3 times a day" or "at 9 AM, 2 PM and 8 PM" or "subah sham dawai leni hai"), populate "multiTimes" with 24-hour "HH:MM" strings (e.g. ["09:00", "14:00", "20:00"]) and set "repeatRule" to "daily".
   - If the user wants a repeating interval (e.g. "every 3 hours", "every 30 minutes", "har 2 ghante mein"), set "repeatRule" to "every_<N>_<seconds|minutes|hours|days|weeks>" (e.g. "every_3_hours"). Otherwise use "none", "daily", or "weekly".
   - If the user mentions sub-steps, populate "subtasks" as an array of strings.

Return ONLY valid JSON matching this exact schema:
{
  "transcript": "Full transcribed text of what the user said or typed",
  "title": "Clean, concise actionable task title (e.g. 'Take medicine' or 'Call Rahul')",
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
      let cleanBase64 = commaIdx !== -1 ? audioBase64.slice(commaIdx + 1) : audioBase64;
      let detectedMime = audioMimeType || 'audio/webm';
      if (commaIdx !== -1) {
        const header = audioBase64.slice(0, commaIdx);
        const mimeMatch = header.match(/^data:([^;]+)/);
        if (mimeMatch && mimeMatch[1]) {
          detectedMime = mimeMatch[1];
        }
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
      const errText = await response.text();
      console.warn('Gemini API error response:', response.status, errText);
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
      transcript: parsedObj.transcript || rawText || parsedObj.title || 'Voice Note Reminder',
      title: parsedObj.title || 'Voice Note Reminder',
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
    console.warn('Gemini AI parsing exception, falling back to local NLP:', err.message);
    const fallback = parseReminderInput(rawText, referenceDate);
    return {
      ...fallback,
      aiEngine: 'rule-based-fallback',
      transcript: rawText
    };
  }
}

module.exports = { parseWithGeminiAI };
