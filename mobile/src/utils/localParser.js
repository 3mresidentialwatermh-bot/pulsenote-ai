/**
 * On-device AI Natural Language Parser for Offline-First Mobile Operation.
 * Extracts title, scheduledAt, priority, category, repeatRule, actionLink, locationTrigger, and requireProof
 * directly on the phone even when the cloud backend / tunnel is offline.
 */
export function getLocalRepeatRuleMeta(repeatRule) {
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

function normalizeUnit(rawUnit) {
  const u = (rawUnit || '').toLowerCase();
  if (u.startsWith('s')) return 'seconds';
  if (u.startsWith('m')) return 'minutes';
  if (u.startsWith('h')) return 'hours';
  if (u.startsWith('d')) return 'days';
  if (u.startsWith('w')) return 'weeks';
  return 'hours';
}

export function parseReminderLocally(rawText, referenceDate = new Date()) {
  const input = (rawText || '').trim();
  if (!input) {
    return {
      title: 'Untitled Reminder',
      scheduledAt: new Date(referenceDate.getTime() + 60 * 1000).toISOString(),
      priority: 'medium',
      category: 'general',
      repeatRule: 'none',
      repeatLabel: 'One-time',
      actionLink: '',
      locationTrigger: '',
      assignedToEmail: '',
      requireProof: false,
      parsedTimeText: 'in 1 minute (default)'
    };
  }

  let priority = 'medium';
  let requireProof = false;
  if (/\b(urgent|asap|important|critical|high priority|immediately|must|wake)\b/i.test(input)) {
    priority = 'high';
    requireProof = true;
  } else if (/\b(low priority|whenever|optional|someday)\b/i.test(input)) {
    priority = 'low';
  }

  // Category detection
  let category = 'general';
  if (/\b(water|hydrate|drink|vitamin|medicine|pill|workout|gym|walk|stretch|doctor|dentist|sleep|health|run|yoga)\b/i.test(input)) {
    category = 'health';
  } else if (/\b(tax|invoice|bill|rent|bank|pay|payment|salary|budget|subscription|loan|emi|finance)\b/i.test(input)) {
    category = 'finance';
  } else if (/\b(client|meeting|zoom|report|project|deadline|email|boss|team|standup|proposal|contract|slack|deploy|server|code|work)\b/i.test(input)) {
    category = 'work';
  } else if (/\b(mom|dad|wife|husband|birthday|anniversary|grocery|milk|buy|shop|call|clean|home|dinner|family)\b/i.test(input)) {
    category = 'personal';
  }

  // Smart entities
  let actionLink = '';
  const urlMatch = input.match(/https?:\/\/[^\s]+/i);
  const phoneMatch = input.match(/(?:\+?\d[\d\-\s]{7,14}\d)/);
  if (urlMatch) {
    actionLink = urlMatch[0];
  } else if (phoneMatch) {
    actionLink = `tel:${phoneMatch[0].replace(/[\s\-]/g, '')}`;
  } else if (/\b(zoom|meet|teams|standup|video call)\b/i.test(input)) {
    actionLink = 'https://meet.google.com/new';
  }

  let locationTrigger = '';
  const locMatch = input.match(/\b(?:when\s+i\s+(?:reach|arrive\s+at|get\s+to)|near|at\s+the)\s+([a-zA-Z0-9\s]{3,22}?)(?:\b(?:in|at|every|tomorrow|today|$))/i);
  if (locMatch && locMatch[1]) {
    const candidate = locMatch[1].trim();
    if (!/^(morning|evening|night|noon|moment)$/i.test(candidate)) {
      locationTrigger = candidate;
    }
  }

  let assignedToEmail = '';
  const emailMatch = input.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) {
    assignedToEmail = emailMatch[1];
  }

  // Recurrence detection
  let repeatRule = 'none';
  let matchedRepeatPhrase = '';

  const intervalRegex = /\b(?:every|each|repeat\s+every)\s+(\d+)?\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks)\b/i;
  const afterRepeatRegex = /\b(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\s+after\b/i;

  const intervalMatch = input.match(intervalRegex);
  const afterMatch = input.match(afterRepeatRegex);

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

  const repeatMeta = getLocalRepeatRuleMeta(repeatRule);
  const inputWithoutRepeat = matchedRepeatPhrase
    ? input.replace(matchedRepeatPhrase, ' ')
    : input;

  let scheduledDate = null;
  let parsedTimeText = '';
  let cleanedTitle = inputWithoutRepeat;

  // 1. Check relative "in X sec/min/hours" or "X hours after"
  const relMatch = inputWithoutRepeat.match(
    /\bin\s+(\d+)\s*(s|sec|secs|seconds|m|min|mins|minutes|h|hr|hrs|hours|d|day|days)\b/i
  );

  // 2. Check explicit clock time like "tomorrow at 10:30 AM" or "at 5 PM"
  const timeMatch = inputWithoutRepeat.match(
    /\b(tomorrow\s+)?(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
  );

  if (relMatch) {
    const count = parseInt(relMatch[1], 10);
    const unit = normalizeUnit(relMatch[2]);
    const meta = getLocalRepeatRuleMeta(`every_${count}_${unit}`);
    scheduledDate = new Date(referenceDate.getTime() + meta.intervalMs);
    parsedTimeText = relMatch[0];
    cleanedTitle = inputWithoutRepeat.replace(relMatch[0], '').trim();
  } else if (afterMatch) {
    const count = parseInt(afterMatch[1], 10);
    const unit = normalizeUnit(afterMatch[2]);
    const meta = getLocalRepeatRuleMeta(`every_${count}_${unit}`);
    scheduledDate = new Date(referenceDate.getTime() + meta.intervalMs);
    parsedTimeText = afterMatch[0];
    cleanedTitle = inputWithoutRepeat.replace(afterMatch[0], '').trim();
  } else if (timeMatch) {
    const isTomorrow = !!timeMatch[1];
    let hours = parseInt(timeMatch[2], 10);
    const mins = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
    const ampm = timeMatch[4].toLowerCase();
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;

    scheduledDate = new Date(referenceDate);
    scheduledDate.setHours(hours, mins, 0, 0);
    if (isTomorrow || scheduledDate.getTime() <= referenceDate.getTime()) {
      scheduledDate.setDate(scheduledDate.getDate() + 1);
    }
    parsedTimeText = timeMatch[0];
    cleanedTitle = inputWithoutRepeat.replace(timeMatch[0], '').trim();
  } else if (repeatMeta.isRecurring) {
    scheduledDate = new Date(referenceDate.getTime() + repeatMeta.intervalMs);
    parsedTimeText = `${repeatMeta.label} (next in ${repeatMeta.label.replace(/^Every\s+/i, '')})`;
  } else {
    scheduledDate = new Date(referenceDate.getTime() + 60 * 1000);
    parsedTimeText = 'in 1 minute (default)';
  }

  cleanedTitle = cleanedTitle
    .replace(/^(hey\s+ai\s*,?\s*|please\s+|can\s+you\s+|could\s+you\s+)?(urgent\s*:\s*|important\s*:\s*)?(remind\s+me\s+to\s+|remind\s+me\s+about\s+|remind\s+me\s+that\s+|remind\s+me\s+|set\s+a?\s*reminder\s+to\s+|set\s+a?\s*reminder\s+for\s+|set\s+an?\s*alarm\s+to\s+|set\s+an?\s*alarm\s+for\s+|don't\s+let\s+me\s+forget\s+to\s+|i\s+need\s+to\s+|remember\s+to\s+)/i, '')
    .replace(/\b(and\s+repeat|repeat|repeating|at|on|by|in|for|around|after)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,\-:\s]+|[,\-:\s.]+$/g, '')
    .trim();

  if (!cleanedTitle) cleanedTitle = input;
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
