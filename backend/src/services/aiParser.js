const chrono = require('chrono-node');

/**
 * Helper to convert a repeatRule string (e.g., 'every_3_hours', 'every_30_minutes', 'hourly', 'daily', 'weekly')
 * into milliseconds and a human-readable label.
 */
function getRepeatRuleMeta(repeatRule) {
  if (!repeatRule || repeatRule === 'none') {
    return { isRecurring: false, intervalMs: 0, label: 'One-time' };
  }

  if (repeatRule === 'hourly' || repeatRule === 'every_1_hours') {
    return { isRecurring: true, intervalMs: 3600 * 1000, label: 'Every 1 hour' };
  }
  if (repeatRule === 'daily' || repeatRule === 'every_1_days') {
    return { isRecurring: true, intervalMs: 24 * 3600 * 1000, label: 'Every day' };
  }
  if (repeatRule === 'weekly' || repeatRule === 'every_1_weeks') {
    return { isRecurring: true, intervalMs: 7 * 24 * 3600 * 1000, label: 'Every week' };
  }

  const customMatch = repeatRule.match(/^every_(\d+)_(seconds|minutes|hours|days|weeks)$/);
  if (customMatch) {
    const count = parseInt(customMatch[1], 10);
    const unit = customMatch[2];
    const multipliers = {
      seconds: 1000,
      minutes: 60 * 1000,
      hours: 3600 * 1000,
      days: 24 * 3600 * 1000,
      weeks: 7 * 24 * 3600 * 1000
    };
    const singularUnit = unit.replace(/s$/, '');
    return {
      isRecurring: true,
      intervalMs: count * (multipliers[unit] || 60000),
      label: `Every ${count} ${count === 1 ? singularUnit : unit}`
    };
  }

  return { isRecurring: false, intervalMs: 0, label: repeatRule };
}

/**
 * Adjusts a scheduled Date if it falls inside the user's Quiet Hours window (e.g. 22:00 to 08:00).
 */
function applyQuietHours(scheduledDate, user) {
  if (!user || !user.quiet_hours_enabled) {
    return { adjustedDate: scheduledDate, wasAdjusted: false };
  }

  const startStr = user.quiet_hours_start || '22:00';
  const endStr = user.quiet_hours_end || '08:00';
  const [startH, startM] = startStr.split(':').map(Number);
  const [endH, endM] = endStr.split(':').map(Number);

  const d = new Date(scheduledDate);
  const mins = d.getHours() * 60 + d.getMinutes();
  const startMins = startH * 60 + (startM || 0);
  const endMins = endH * 60 + (endM || 0);

  let inQuietHours = false;
  if (startMins > endMins) {
    // Overnight window e.g. 22:00 -> 08:00
    inQuietHours = mins >= startMins || mins < endMins;
  } else {
    inQuietHours = mins >= startMins && mins < endMins;
  }

  if (!inQuietHours) {
    return { adjustedDate: scheduledDate, wasAdjusted: false };
  }

  const adjusted = new Date(d);
  if (startMins > endMins && mins >= startMins) {
    // Move to next morning at endH:endM
    adjusted.setDate(adjusted.getDate() + 1);
  }
  adjusted.setHours(endH, endM || 0, 0, 0);
  return { adjustedDate: adjusted, wasAdjusted: true };
}

/**
 * Auto-detects category from natural language input.
 */
function detectCategory(input) {
  if (/\b(water|hydrate|drink|vitamin|medicine|pill|workout|gym|walk|stretch|doctor|dentist|sleep|health|run|yoga)\b/i.test(input)) {
    return 'health';
  }
  if (/\b(tax|invoice|bill|rent|bank|pay|payment|salary|budget|subscription|loan|emi|finance)\b/i.test(input)) {
    return 'finance';
  }
  if (/\b(client|meeting|zoom|report|project|deadline|email|boss|team|standup|proposal|contract|slack|deploy|server|code|work)\b/i.test(input)) {
    return 'work';
  }
  if (/\b(mom|dad|wife|husband|birthday|anniversary|grocery|milk|buy|shop|call|clean|home|dinner|family)\b/i.test(input)) {
    return 'personal';
  }
  return 'general';
}

/**
 * Extracts actionable links (tel:, https:, mailto:), location triggers, and delegated assignee from raw text.
 */
function extractSmartEntities(input) {
  let actionLink = '';
  const urlMatch = input.match(/https?:\/\/[^\s]+/i);
  const phoneMatch = input.match(/(?:\+?\d[\d\-\s]{7,14}\d)/);
  if (urlMatch) {
    actionLink = urlMatch[0];
  } else if (phoneMatch) {
    actionLink = `tel:${phoneMatch[0].replace(/[\s\-]/g, '')}`;
  } else if (/\bcall\s+([A-Z][a-z]+)\b/.test(input)) {
    actionLink = 'tel:+18005550199';
  } else if (/\b(zoom|meet|teams|standup|video call)\b/i.test(input)) {
    actionLink = 'https://meet.google.com/new';
  }

  // Detect location trigger e.g. "when I arrive at office", "at supermarket", "@gym"
  let locationTrigger = '';
  const locMatch = input.match(/\b(?:when\s+i\s+(?:reach|arrive\s+at|get\s+to)|near|at\s+the)\s+([a-zA-Z0-9\s]{3,22}?)(?:\b(?:in|at|every|tomorrow|today|$))/i);
  if (locMatch && locMatch[1]) {
    const candidate = locMatch[1].trim();
    if (!/^(morning|evening|night|noon|moment)$/i.test(candidate)) {
      locationTrigger = candidate;
    }
  }

  // Detect delegated person e.g. "assign to rahul@company.com" or "remind @rahul"
  let assignedToEmail = '';
  const emailMatch = input.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) {
    assignedToEmail = emailMatch[1];
  }

  return { actionLink, locationTrigger, assignedToEmail };
}

/**
 * Converts spoken English number words (from voice transcription) into digits
 * so "every three hours" or "in twenty seconds" or "after two minutes" parses identically to digits.
 */
function normalizeSpokenNumbers(text) {
  const wordToNum = {
    one: '1', a: '1', an: '1',
    two: '2', three: '3', four: '4', five: '5',
    six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
    eleven: '11', twelve: '12', fifteen: '15', twenty: '20',
    thirty: '30', forty: '40', 'forty-five': '45', fifty: '50', sixty: '60'
  };
  return text.replace(
    /\b(forty-five|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty)\b(?=\s+(?:s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks)\b)/gi,
    (m) => wordToNum[m.toLowerCase()] || m
  );
}

function parseReminderInput(rawText, referenceDate = new Date()) {
  const input = normalizeSpokenNumbers((rawText || '').trim());
  if (!input) {
    return {
      title: 'Untitled Reminder',
      scheduledAt: new Date(referenceDate.getTime() + 5 * 60 * 1000).toISOString(),
      priority: 'medium',
      category: 'general',
      repeatRule: 'none',
      repeatLabel: 'One-time',
      actionLink: '',
      locationTrigger: '',
      assignedToEmail: '',
      requireProof: false,
      parsedTimeText: 'in 5 minutes (default)'
    };
  }

  // Priority
  let priority = 'medium';
  let requireProof = false;
  if (/\b(urgent|asap|important|critical|high priority|immediately|must|wake)\b/i.test(input)) {
    priority = 'high';
    requireProof = true;
  } else if (/\b(low priority|whenever|optional|someday)\b/i.test(input)) {
    priority = 'low';
  }

  const category = detectCategory(input);
  const { actionLink, locationTrigger, assignedToEmail } = extractSmartEntities(input);

  // Recurrence
  let repeatRule = 'none';
  let matchedRepeatPhrase = '';

  const intervalRegex = /\b(?:every|each|repeat\s+every)\s+(\d+)?\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks)\b/i;
  const afterRepeatRegex = /\b(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\s+after\b/i;

  const intervalMatch = input.match(intervalRegex);
  const afterMatch = input.match(afterRepeatRegex);

  function normalizeUnit(rawUnit) {
    const u = rawUnit.toLowerCase();
    if (u.startsWith('s')) return 'seconds';
    if (u.startsWith('m')) return 'minutes';
    if (u.startsWith('h')) return 'hours';
    if (u.startsWith('d')) return 'days';
    if (u.startsWith('w')) return 'weeks';
    return 'hours';
  }

  if (intervalMatch) {
    const count = intervalMatch[1] ? parseInt(intervalMatch[1], 10) : 1;
    const unit = normalizeUnit(intervalMatch[2]);
    repeatRule = `every_${count}_${unit}`;
    matchedRepeatPhrase = intervalMatch[0];
  } else if (/\b(hourly|every hour)\b/i.test(input)) {
    repeatRule = 'every_1_hours';
    matchedRepeatPhrase = (input.match(/\b(hourly|every hour)\b/i) || [''])[0];
  } else if (/\b(every day|daily|each day)\b/i.test(input)) {
    repeatRule = 'daily';
    matchedRepeatPhrase = (input.match(/\b(every day|daily|each day)\b/i) || [''])[0];
  } else if (/\b(every week|weekly|each week)\b/i.test(input)) {
    repeatRule = 'weekly';
    matchedRepeatPhrase = (input.match(/\b(every week|weekly|each week)\b/i) || [''])[0];
  } else if (afterMatch && /\b(repeat|repeating|again)\b/i.test(input)) {
    const count = parseInt(afterMatch[1], 10);
    const unit = normalizeUnit(afterMatch[2]);
    repeatRule = `every_${count}_${unit}`;
    matchedRepeatPhrase = afterMatch[0];
  }

  const repeatMeta = getRepeatRuleMeta(repeatRule);

  const inputWithoutRepeat = matchedRepeatPhrase
    ? input.replace(matchedRepeatPhrase, ' ')
    : input;

  const results = chrono.parse(inputWithoutRepeat, referenceDate, { forwardDate: true });

  let scheduledDate = null;
  let parsedTimeText = '';
  let cleanedTitle = inputWithoutRepeat;

  if (results && results.length > 0) {
    const match = results[0];
    scheduledDate = match.start.date();
    parsedTimeText = match.text;

    cleanedTitle = (
      inputWithoutRepeat.slice(0, match.index) +
      ' ' +
      inputWithoutRepeat.slice(match.index + match.text.length)
    ).trim();
  } else if (afterMatch) {
    const count = parseInt(afterMatch[1], 10);
    const unit = normalizeUnit(afterMatch[2]);
    const meta = getRepeatRuleMeta(`every_${count}_${unit}`);
    scheduledDate = new Date(referenceDate.getTime() + meta.intervalMs);
    parsedTimeText = afterMatch[0];
    cleanedTitle = inputWithoutRepeat.replace(afterMatch[0], '').trim();
  } else {
    const relMatch = inputWithoutRepeat.match(
      /\b(?:in|after|for)\s+(\d+)\s*(s|sec|secs|seconds|m|min|mins|minutes|h|hr|hrs|hours)\b/i
    );
    if (relMatch) {
      const count = parseInt(relMatch[1], 10);
      const unit = normalizeUnit(relMatch[2]);
      const meta = getRepeatRuleMeta(`every_${count}_${unit}`);
      scheduledDate = new Date(referenceDate.getTime() + meta.intervalMs);
      parsedTimeText = relMatch[0];
      cleanedTitle = inputWithoutRepeat.replace(relMatch[0], '').trim();
    } else if (repeatMeta.isRecurring) {
      scheduledDate = new Date(referenceDate.getTime() + repeatMeta.intervalMs);
      parsedTimeText = `${repeatMeta.label} (next in ${repeatMeta.label.replace(/^Every\s+/i, '')})`;
    } else {
      scheduledDate = new Date(referenceDate.getTime() + 60 * 1000);
      parsedTimeText = 'in 1 minute (default)';
    }
  }

  cleanedTitle = cleanedTitle
    .replace(/^(hey\s+ai\s*,?\s*|please\s+|can\s+you\s+|could\s+you\s+)?(urgent\s*:\s*|important\s*:\s*)?(remind\s+me\s+to\s+|remind\s+me\s+about\s+|remind\s+me\s+that\s+|remind\s+me\s+|set\s+a?\s*reminder\s+to\s+|set\s+a?\s*reminder\s+for\s+|set\s+an?\s*alarm\s+to\s+|set\s+an?\s*alarm\s+for\s+|don't\s+let\s+me\s+forget\s+to\s+|i\s+need\s+to\s+|remember\s+to\s+)/i, '')
    .replace(/\b(and\s+repeat|repeat|repeating|at|on|by|in|for|around|after)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,\-:\s]+|[,\-:\s.]+$/g, '')
    .trim();

  if (!cleanedTitle) {
    cleanedTitle = input;
  }

  cleanedTitle = cleanedTitle.charAt(0).toUpperCase() + cleanedTitle.slice(1);

  return {
    title: cleanedTitle,
    scheduledAt: scheduledDate.toISOString(),
    priority,
    category,
    repeatRule,
    repeatLabel: repeatMeta.label,
    actionLink,
    locationTrigger,
    assignedToEmail,
    requireProof,
    parsedTimeText
  };
}

module.exports = { parseReminderInput, getRepeatRuleMeta, applyQuietHours };
