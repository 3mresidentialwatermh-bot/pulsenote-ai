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

function normalizeSpokenNumbers(text) {
  const wordToNum = {
    one: '1', a: '1', an: '1',
    two: '2', three: '3', four: '4', five: '5',
    six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
    eleven: '11', twelve: '12', fifteen: '15', twenty: '20',
    thirty: '30', forty: '40', 'forty-five': '45', fifty: '50', sixty: '60'
  };

  let normalized = text
    // 1. Convert dot-separated times like "7.30" or "7.30 pm" into "7:30"
    .replace(/\b(\d{1,2})\.(\d{2})\b/g, '$1:$2')
    // 2. Convert space-separated spoken clock times like "at 7 30" or "by 7 30" into "at 7:30"
    .replace(/\b(at|by|for|around|alarm)\s+(\d{1,2})\s+([0-5]\d)\b/gi, '$1 $2:$3')
    // 3. Convert spoken "seven thirty" into "7:30"
    .replace(
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(fifteen|twenty|thirty|forty|forty-five|fifty)\b/gi,
      (_, h, m) => `${wordToNum[h.toLowerCase()]}:${wordToNum[m.toLowerCase()]}`
    );

  // 4. Convert spoken numbers before time units ("three hours" -> "3 hours")
  return normalized.replace(
    /\b(forty-five|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty)\b(?=\s+(?:s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|am|pm|o'clock)\b)/gi,
    (m) => wordToNum[m.toLowerCase()] || m
  );
}

function parseExplicitClockTime(text, referenceDate) {
  const clockRegex = /\b(tomorrow\s+)?(?:(?:at|by|for|around|alarm)\s+)?(\d{1,2})(?::([0-5]\d))?(?:\s*(am|pm))?\b/i;
  // Require either a colon (e.g. "7:30"), an am/pm suffix (e.g. "7 pm"), or a time preposition ("at 7", "by 7")
  const strictClockRegex = /\b(tomorrow\s+)?(?:(?:(?:at|by|for|around)\s+)(\d{1,2})(?::([0-5]\d))?(?:\s*(am|pm))?|(\d{1,2}):([0-5]\d)(?:\s*(am|pm))?|(\d{1,2})(?::([0-5]\d))?\s*(am|pm))\b/i;
  const m = text.match(strictClockRegex);
  if (!m) return null;

  const isTomorrow = !!m[1];
  const hoursRaw = m[2] || m[5] || m[8];
  const minsRaw = m[3] || m[6] || m[9] || '0';
  const meridiemRaw = m[4] || m[7] || m[10] || null;

  let hours = parseInt(hoursRaw, 10);
  const mins = parseInt(minsRaw, 10);
  const meridiem = meridiemRaw ? meridiemRaw.toLowerCase() : null;

  if (isNaN(hours) || hours > 23) return null;

  const candidate = new Date(referenceDate);
  if (meridiem) {
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    candidate.setHours(hours, mins, 0, 0);
    if (isTomorrow || candidate.getTime() <= referenceDate.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return { date: candidate, matchedText: m[0] };
  } else if (hours <= 12) {
    const amDate = new Date(referenceDate);
    amDate.setHours(hours === 12 ? 0 : hours, mins, 0, 0);
    if (amDate.getTime() <= referenceDate.getTime()) {
      amDate.setDate(amDate.getDate() + 1);
    }

    const pmDate = new Date(referenceDate);
    pmDate.setHours(hours === 12 ? 12 : hours + 12, mins, 0, 0);
    if (pmDate.getTime() <= referenceDate.getTime()) {
      pmDate.setDate(pmDate.getDate() + 1);
    }

    const chosen = amDate.getTime() < pmDate.getTime() ? amDate : pmDate;
    if (isTomorrow) {
      chosen.setDate(chosen.getDate() + 1);
    }
    return { date: chosen, matchedText: m[0] };
  } else {
    candidate.setHours(hours, mins, 0, 0);
    if (isTomorrow || candidate.getTime() <= referenceDate.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return { date: candidate, matchedText: m[0] };
  }
}

function parseMultiTimesSchedule(text, referenceDate) {
  let slots = [];
  let matchedPhrases = [];

  const freqMatch = text.match(/\b(twice|two\s+times|three\s+times|four\s+times|(\d)\s*times)\s+(?:a\s+day|per\s+day|daily|in\s+a\s+day)\b/i);
  if (freqMatch) {
    matchedPhrases.push(freqMatch[0]);
    const rawWord = freqMatch[1].toLowerCase();
    let count = parseInt(freqMatch[2] || '0', 10);
    if (!count) {
      if (rawWord.startsWith('tw')) count = 2;
      else if (rawWord.startsWith('th')) count = 3;
      else if (rawWord.startsWith('fo')) count = 4;
    }
    if (count === 2) slots = ['09:00', '21:00'];
    else if (count === 3) slots = ['09:00', '14:00', '20:00'];
    else if (count >= 4) slots = ['08:00', '12:00', '16:00', '20:00'];
  }

  const multiClockRegex = /\b(\d{1,2}):([0-5]\d)(?:\s*(am|pm))?|\b(\d{1,2})\s*(am|pm)\b/gi;
  const clockMatches = [...text.matchAll(multiClockRegex)];
  if (clockMatches.length >= 2) {
    const explicitSlots = [];
    for (const cm of clockMatches) {
      matchedPhrases.push(cm[0]);
      let h = parseInt(cm[1] || cm[4], 10);
      const mins = parseInt(cm[2] || '0', 10);
      const mer = (cm[3] || cm[5] || '').toLowerCase();
      if (mer === 'pm' && h < 12) h += 12;
      if (mer === 'am' && h === 12) h = 0;
      if (h >= 0 && h <= 23) {
        const hh = String(h).padStart(2, '0');
        const mm = String(mins).padStart(2, '0');
        if (!explicitSlots.includes(`${hh}:${mm}`)) {
          explicitSlots.push(`${hh}:${mm}`);
        }
      }
    }
    if (explicitSlots.length >= 2) {
      slots = explicitSlots;
    }
  }

  if (slots.length < 2) return null;

  const scheduledDates = slots
    .map((slot) => {
      const [h, m] = slot.split(':').map(Number);
      const d = new Date(referenceDate);
      d.setHours(h, m, 0, 0);
      if (d.getTime() <= referenceDate.getTime()) {
        d.setDate(d.getDate() + 1);
      }
      return { slot, date: d, iso: d.toISOString() };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    slots,
    scheduledDates,
    matchedPhrases
  };
}

export function parseReminderLocally(rawText, referenceDate = new Date()) {
  const input = normalizeSpokenNumbers((rawText || '').trim());
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
  let multiTimes = [];

  // 1. Check multi-time schedule ("3 times a day", "at 9 AM, 2 PM and 8 PM")
  const multiSchedule = parseMultiTimesSchedule(inputWithoutRepeat, referenceDate);

  // 2. Check relative "in X sec/min/hours" or "after X minutes" or "X hours after"
  const relMatch = inputWithoutRepeat.match(
    /\b(?:in|after|for)\s+(\d+)\s*(s|sec|secs|seconds|m|min|mins|minutes|h|hr|hrs|hours|d|day|days)\b/i
  );

  // 3. Check explicit clock time like "tomorrow at 10:30 AM", "at 5 PM", "by 7.30", "at 7:30"
  const explicitClock = parseExplicitClockTime(inputWithoutRepeat, referenceDate);

  if (multiSchedule) {
    scheduledDate = multiSchedule.scheduledDates[0].date;
    multiTimes = multiSchedule.slots;
    repeatRule = 'daily';
    parsedTimeText = `${multiSchedule.slots.length}x Daily (${multiSchedule.slots.join(', ')})`;
    for (const phrase of multiSchedule.matchedPhrases) {
      cleanedTitle = cleanedTitle.replace(phrase, ' ');
    }
    cleanedTitle = cleanedTitle.replace(/\b(at|and|on|by)\b/gi, ' ').trim();
  } else if (relMatch) {
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
  } else if (explicitClock) {
    scheduledDate = explicitClock.date;
    parsedTimeText = explicitClock.matchedText;
    cleanedTitle = inputWithoutRepeat.replace(explicitClock.matchedText, '').trim();
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
    multiTimes,
    priority,
    category,
    repeatRule,
    repeatLabel: multiTimes.length > 1 ? `${multiTimes.length}x Daily (${multiTimes.join(', ')})` : repeatMeta.label,
    actionLink,
    locationTrigger,
    assignedToEmail,
    requireProof,
    parsedTimeText
  };
}
