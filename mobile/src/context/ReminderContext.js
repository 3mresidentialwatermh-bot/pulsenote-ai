import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Vibration, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest, API_BASE_URL } from '../config/api';
import { useAuth } from './AuthContext';
import { startAlarmRinging, stopAlarmRinging } from '../utils/sound';
import { parseReminderLocally, getLocalRepeatRuleMeta } from '../utils/localParser';

const ReminderContext = createContext(null);

const REMINDERS_CACHE_KEY = '@pulsenote_reminders_cache';
const LOGS_CACHE_KEY = '@pulsenote_logs_cache';

export function ReminderProvider({ children }) {
  const { user, token, setUser, setIsOffline, refreshUser } = useAuth();
  const [reminders, setReminders] = useState([]);
  const [logs, setLogs] = useState([]);
  const [logStats, setLogStats] = useState({
    created: 0,
    triggered: 0,
    snoozed: 0,
    completed: 0,
    missed: 0,
    deleted: 0
  });
  const [analytics, setAnalytics] = useState({
    completionRate: 100,
    streakDays: 1,
    categories: [],
    mostSnoozed: []
  });
  const [activeAlarm, setActiveAlarm] = useState(null);
  const [focusTask, setFocusTask] = useState(null);
  const [focusDefaultMinutes, setFocusDefaultMinutes] = useState(25);
  const [pushStatus, setPushStatus] = useState('checking'); // 'checking' | 'enabled' | 'prompt' | 'denied' | 'unsupported'
  const [loading, setLoading] = useState(false);

  function startFocusSession(reminder, minutes = 25) {
    stopAlarmRinging();
    setFocusDefaultMinutes(minutes);
    setFocusTask(reminder);
  }

  function closeFocusSession() {
    setFocusTask(null);
  }

  const triggeredKeysRef = useRef(new Set());

  function recomputeLocalStatsAndAnalytics(remList, logList) {
    const stats = {
      created: 0,
      triggered: 0,
      snoozed: 0,
      completed: 0,
      missed: 0,
      deleted: 0
    };
    for (const l of logList) {
      if (stats[l.action] !== undefined) stats[l.action]++;
    }
    setLogStats(stats);

    const catMap = {};
    for (const r of remList) {
      const c = r.category || 'general';
      catMap[c] = (catMap[c] || 0) + 1;
    }
    const categories = Object.entries(catMap).map(([category, count]) => ({
      category,
      count
    }));
    const mostSnoozed = remList
      .filter((r) => r.snooze_count > 0)
      .sort((a, b) => b.snooze_count - a.snooze_count)
      .slice(0, 5);

    const totalFinished = stats.completed + stats.missed;
    const completionRate =
      totalFinished > 0 ? Math.round((stats.completed / totalFinished) * 100) : 100;

    setAnalytics({
      completionRate,
      streakDays: user?.streak_days || 1,
      categories,
      mostSnoozed
    });
  }

  async function saveLocalCache(remList, logList) {
    if (remList) {
      setReminders(remList);
      await AsyncStorage.setItem(REMINDERS_CACHE_KEY, JSON.stringify(remList));
    }
    if (logList) {
      setLogs(logList);
      await AsyncStorage.setItem(LOGS_CACHE_KEY, JSON.stringify(logList));
    }
    recomputeLocalStatsAndAnalytics(remList || reminders, logList || logs);
  }

  const loadCachedData = useCallback(async () => {
    try {
      const [remJson, logJson] = await Promise.all([
        AsyncStorage.getItem(REMINDERS_CACHE_KEY),
        AsyncStorage.getItem(LOGS_CACHE_KEY)
      ]);
      const remList = remJson ? JSON.parse(remJson) : [];
      const logList = logJson ? JSON.parse(logJson) : [];
      setReminders(remList);
      setLogs(logList);
      recomputeLocalStatsAndAnalytics(remList, logList);
    } catch (e) {}
  }, [user?.streak_days]);

  const fetchReminders = useCallback(async () => {
    if (!token) return;
    if (token.startsWith('offline-token')) {
      await loadCachedData();
      return;
    }
    try {
      const data = await apiRequest('/api/reminders', { token });
      const list = data.reminders || [];
      setReminders(list);
      await AsyncStorage.setItem(REMINDERS_CACHE_KEY, JSON.stringify(list));
      setIsOffline(false);
    } catch (err) {
      setIsOffline(true);
      await loadCachedData();
    }
  }, [token, loadCachedData]);

  const fetchLogs = useCallback(async (actionFilter = 'all', inputTypeFilter = 'all') => {
    if (!token) return;
    if (token.startsWith('offline-token')) {
      const logJson = await AsyncStorage.getItem(LOGS_CACHE_KEY);
      const allLogs = logJson ? JSON.parse(logJson) : [];
      const filtered = allLogs.filter(
        (l) =>
          (actionFilter === 'all' || l.action === actionFilter) &&
          (inputTypeFilter === 'all' || l.input_type === inputTypeFilter)
      );
      setLogs(filtered);
      return;
    }
    try {
      const query = `?action=${encodeURIComponent(actionFilter)}&inputType=${encodeURIComponent(inputTypeFilter)}`;
      const data = await apiRequest(`/api/logs${query}`, { token });
      const list = data.logs || [];
      setLogs(list);
      if (actionFilter === 'all' && inputTypeFilter === 'all') {
        await AsyncStorage.setItem(LOGS_CACHE_KEY, JSON.stringify(list));
      }
      if (data.stats) setLogStats(data.stats);
      if (data.analytics) setAnalytics(data.analytics);
      setIsOffline(false);
    } catch (err) {
      setIsOffline(true);
      const logJson = await AsyncStorage.getItem(LOGS_CACHE_KEY);
      const allLogs = logJson ? JSON.parse(logJson) : [];
      const filtered = allLogs.filter(
        (l) =>
          (actionFilter === 'all' || l.action === actionFilter) &&
          (inputTypeFilter === 'all' || l.input_type === inputTypeFilter)
      );
      setLogs(filtered);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      setLoading(true);
      loadCachedData().then(() => {
        Promise.all([fetchReminders(), fetchLogs()]).finally(() => setLoading(false));
      });
    } else {
      setReminders([]);
      setLogs([]);
      setActiveAlarm(null);
      stopAlarmRinging();
    }
  }, [token, fetchReminders, fetchLogs]);

  // Sync reminders list into the Service Worker so background timers & Notification Triggers can fire even when tab is minimized
  useEffect(() => {
    if (
      Platform.OS === 'web' &&
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator
    ) {
      navigator.serviceWorker.ready
        .then((reg) => {
          if (reg.active) {
            reg.active.postMessage({
              type: 'SYNC_REMINDERS',
              reminders: reminders.filter(
                (r) => r.status === 'pending' || r.status === 'snoozed'
              )
            });
          }
        })
        .catch(() => {});
    }
  }, [reminders]);

  const registerBackgroundPush = useCallback(
    async (requestUserGesture = false) => {
      if (Platform.OS !== 'web' || typeof window === 'undefined') {
        setPushStatus('unsupported');
        return false;
      }
      try {
        if (!('Notification' in window) || !('serviceWorker' in navigator)) {
          setPushStatus('unsupported');
          return false;
        }
        let perm = window.Notification.permission;
        if (perm === 'default' && requestUserGesture) {
          perm = await window.Notification.requestPermission();
        }
        if (perm === 'default') {
          setPushStatus('prompt');
          return false;
        }
        if (perm !== 'granted') {
          setPushStatus('denied');
          return false;
        }

        setPushStatus('enabled');

        const reg = await navigator.serviceWorker.ready;
        if (!reg.pushManager) return true;

        const vapidRes = await apiRequest('/api/auth/vapid-public-key');
        if (!vapidRes || !vapidRes.publicKey) return true;

        const padding = '='.repeat((4 - (vapidRes.publicKey.length % 4)) % 4);
        const base64 = (vapidRes.publicKey + padding)
          .replace(/-/g, '+')
          .replace(/_/g, '/');
        const rawData = window.atob(base64);
        const applicationServerKey = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
          applicationServerKey[i] = rawData.charCodeAt(i);
        }

        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey
          });
        }

        await apiRequest('/api/auth/push-subscribe', {
          method: 'POST',
          body: {
            subscription: sub,
            userId: user?.id || 'broadcast'
          }
        });
        return true;
      } catch (err) {
        return false;
      }
    },
    [user?.id]
  );

  // Request system notification permission, subscribe to Web Push (FCM/APNs background wake-up!), & Keep Screen Awake lock
  useEffect(() => {
    if (!token) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if ('wakeLock' in navigator && navigator.wakeLock) {
        navigator.wakeLock.request('screen').catch(() => {});
      }

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
          const msg = event.data;
          if (msg && msg.type === 'NOTIFICATION_ACTION' && msg.reminderId) {
            if (msg.action === 'complete') {
              handleReminderAction(msg.reminderId, 'complete');
            } else if (msg.action === 'snooze_10') {
              handleReminderAction(msg.reminderId, 'snooze', 10);
            }
          }
        });
      }

      registerBackgroundPush(false);
    }
  }, [token, registerBackgroundPush]);

  // Real-time Alarm Scheduler Engine (checks every 1 second, works 100% offline!)
  useEffect(() => {
    if (!token) return;

    const timer = setInterval(() => {
      if (activeAlarm) return;

      const now = Date.now();
      for (const rem of reminders) {
        if (rem.status !== 'pending' && rem.status !== 'snoozed') continue;

        const scheduledTime = new Date(rem.scheduled_at).getTime();
        const triggerKey = `${rem.id}_${rem.scheduled_at}`;

        if (scheduledTime <= now && !triggeredKeysRef.current.has(triggerKey)) {
          // Always RING overdue alarms immediately when the user unlocks/opens the app (up to 12 hours after schedule!)
          // instead of silently marking them missed while the phone screen was off.
          if (now - scheduledTime > 12 * 60 * 60 * 1000) {
            triggeredKeysRef.current.add(triggerKey);
            handleReminderAction(rem.id, 'missed');
            continue;
          }

          triggeredKeysRef.current.add(triggerKey);
          triggerAlarmNow(rem);
          break;
        }
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [token, reminders, activeAlarm]);

  async function appendLocalLog({ reminder, action, details }) {
    const logJson = await AsyncStorage.getItem(LOGS_CACHE_KEY);
    const currentLogs = logJson ? JSON.parse(logJson) : logs;
    const newEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      reminder_id: reminder.id,
      user_id: user?.id || 'local',
      reminder_title: reminder.title,
      input_type: reminder.input_type || 'text',
      audio_url: reminder.audio_url || null,
      action,
      details,
      timestamp: new Date().toISOString()
    };
    const nextLogs = [newEntry, ...currentLogs];
    return nextLogs;
  }

  async function triggerAlarmNow(reminder) {
    setActiveAlarm(reminder);
    startAlarmRinging(reminder, user?.name || '', user?.alarm_tone || 'classic');

    // Fire an OS-level Android/iOS/Desktop Notification via the Service Worker so it pops up over the status bar!
    if (Platform.OS === 'web' && typeof window !== 'undefined' && 'Notification' in window) {
      try {
        if (window.Notification.permission === 'granted') {
          if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.ready;
            await reg.showNotification(`⏰ PulseNote Alarm: ${reminder.title}`, {
              body: reminder.raw_input || 'Tap to view, snooze, or complete your task!',
              icon: '/icon-192.png',
              badge: '/icon-192.png',
              vibrate: [500, 300, 500, 300, 500],
              requireInteraction: true,
              tag: `alarm_${reminder.id}`,
              data: { reminderId: reminder.id },
              actions: [
                { action: 'complete', title: '✅ Mark Done' },
                { action: 'snooze_10', title: '💤 Snooze 10m' }
              ]
            });
          } else {
            new window.Notification(`⏰ PulseNote Alarm: ${reminder.title}`, {
              body: reminder.raw_input || 'Tap to open alarm!'
            });
          }
        }
      } catch (e) {}
    }

    if (Platform.OS !== 'web') {
      Vibration.vibrate([500, 500, 500], true);
    }
    try {
      await apiRequest(`/api/reminders/${reminder.id}/action`, {
        method: 'PATCH',
        token,
        body: { action: 'triggered' }
      });
      fetchLogs();
    } catch (e) {
      const nextLogs = await appendLocalLog({
        reminder,
        action: 'triggered',
        details: 'Alarm rang on device (Offline Mode)'
      });
      await saveLocalCache(reminders, nextLogs);
    }
  }

  async function previewNaturalLanguage(
    text,
    audioBase64 = null,
    audioMimeType = 'audio/webm',
    imageBase64 = null,
    imageMimeType = 'image/jpeg'
  ) {
    if (!text.trim() && !audioBase64 && !imageBase64) return null;
    try {
      if (token && !token.startsWith('offline-token')) {
        const data = await apiRequest('/api/reminders/parse', {
          method: 'POST',
          token,
          body: {
            text,
            audioBase64,
            audioMimeType,
            imageBase64,
            imageMimeType,
            referenceTime: new Date().toISOString()
          }
        });
        return data.parsed;
      }
    } catch (e) {
      // Fallback to on-device parser when offline
    }
    return parseReminderLocally(text, new Date());
  }

  async function fetchDailyBriefing() {
    try {
      if (token && !token.startsWith('offline-token')) {
        return await apiRequest('/api/reminders/briefing', { token });
      }
    } catch (e) {}
    const pending = reminders.filter((r) => r.status === 'pending' || r.status === 'snoozed');
    const firstName = (user?.name || 'there').split(' ')[0];
    return {
      briefing:
        pending.length === 0
          ? `Hey ${firstName}! Your schedule is clear with 0 pending alarms on a ${user?.streak_days || 1}-day streak.`
          : `Hey ${firstName}! You have ${pending.length} active reminder(s). Up next is "${pending[0].title}" at ${new Date(pending[0].scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
      aiEngine: 'local'
    };
  }

  async function runAssistantCommand(command) {
    if (!command || !command.trim()) return null;
    try {
      if (token && !token.startsWith('offline-token')) {
        const res = await apiRequest('/api/reminders/assistant', {
          method: 'POST',
          token,
          body: { command, referenceTime: new Date().toISOString() }
        });
        await Promise.all([fetchReminders(), fetchLogs()]);
        return res;
      }
    } catch (e) {}
    // Local offline assistant fallback
    const pending = reminders.filter((r) => r.status === 'pending' || r.status === 'snoozed');
    const shiftMatch = command.match(/\b(?:push|shift|delay|move|snooze)\b.*?\b(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/i);
    if (shiftMatch) {
      const count = parseInt(shiftMatch[1], 10);
      const isHours = shiftMatch[2].toLowerCase().startsWith('h');
      const offsetMs = count * (isHours ? 3600000 : 60000);
      const nextReminders = reminders.map((r) =>
        r.status === 'pending' || r.status === 'snoozed'
          ? { ...r, scheduled_at: new Date(new Date(r.scheduled_at).getTime() + offsetMs).toISOString() }
          : r
      );
      await saveLocalCache(nextReminders, logs);
      return {
        reply: `Shifted ${pending.length} active reminder(s) forward by ${count} ${isHours ? 'hour(s)' : 'minute(s)'}.`,
        operationsCount: pending.length
      };
    }
    return {
      reply: `You have ${pending.length} active reminder(s). Try "Push all alarms back by 30 minutes".`,
      operationsCount: 0
    };
  }

  async function editReminder(reminderId, updates) {
    try {
      if (token && !token.startsWith('offline-token')) {
        const res = await apiRequest(`/api/reminders/${reminderId}`, {
          method: 'PATCH',
          token,
          body: updates
        });
        await Promise.all([fetchReminders(), fetchLogs()]);
        return res.reminder;
      }
    } catch (e) {}

    // Offline edit fallback
    const nextReminders = reminders.map((r) => {
      if (r.id !== reminderId) return r;
      let nextSched = updates.scheduledAt || r.scheduled_at;
      if (updates.shiftMinutes) {
        const base = Math.max(Date.now(), new Date(r.scheduled_at).getTime());
        nextSched = new Date(base + Number(updates.shiftMinutes) * 60000).toISOString();
      }
      return {
        ...r,
        title: updates.title || r.title,
        scheduled_at: nextSched,
        repeat_rule: updates.repeatRule !== undefined ? updates.repeatRule : r.repeat_rule,
        category: updates.category || r.category,
        alarm_tone: updates.alarmTone || r.alarm_tone || 'classic',
        status: 'pending'
      };
    });
    await saveLocalCache(nextReminders, logs);
    return nextReminders.find((r) => r.id === reminderId);
  }

  async function createReminder({
    rawInput,
    title,
    scheduledAt,
    multiTimes,
    priority,
    category,
    repeatRule,
    alarmTone,
    actionLink,
    locationTrigger,
    assignedToEmail,
    requireProof,
    ttsEnabled,
    subtasks,
    inputType = 'text',
    audioBase64 = null,
    audioExt = '.wav',
    audioDuration = 0,
    audioFileUri = null,
    imageBase64 = null,
    imageMimeType = 'image/jpeg'
  }) {
    try {
      if (token && !token.startsWith('offline-token')) {
        let bodyPayload;
        let isFormData = false;

        if (audioFileUri && Platform.OS !== 'web') {
          const formData = new FormData();
          formData.append('rawInput', rawInput || 'Voice Note Reminder');
          if (title) formData.append('title', title);
          if (scheduledAt) formData.append('scheduledAt', scheduledAt);
          if (multiTimes && multiTimes.length) formData.append('multiTimes', JSON.stringify(multiTimes));
          if (priority) formData.append('priority', priority);
          if (category) formData.append('category', category);
          if (repeatRule) formData.append('repeatRule', repeatRule);
          if (alarmTone) formData.append('alarmTone', alarmTone);
          if (actionLink) formData.append('actionLink', actionLink);
          if (locationTrigger) formData.append('locationTrigger', locationTrigger);
          if (assignedToEmail) formData.append('assignedToEmail', assignedToEmail);
          if (requireProof !== undefined) formData.append('requireProof', String(requireProof));
          if (ttsEnabled !== undefined) formData.append('ttsEnabled', String(ttsEnabled));
          if (subtasks) formData.append('subtasksJson', JSON.stringify(subtasks));
          formData.append('inputType', 'voice');
          formData.append('audioDuration', String(audioDuration || 0));
          formData.append('referenceTime', new Date().toISOString());

          const filename = audioFileUri.split('/').pop() || `voice_${Date.now()}.m4a`;
          formData.append('audio', {
            uri: audioFileUri,
            name: filename,
            type: 'audio/m4a'
          });

          bodyPayload = formData;
          isFormData = true;
        } else {
          bodyPayload = {
            rawInput,
            title,
            scheduledAt,
            multiTimes,
            priority,
            category,
            repeatRule,
            alarmTone,
            actionLink,
            locationTrigger,
            assignedToEmail,
            requireProof,
            ttsEnabled,
            subtasks,
            inputType,
            audioBase64,
            audioExt,
            audioDuration,
            imageBase64,
            imageMimeType,
            referenceTime: new Date().toISOString()
          };
        }

        const data = await apiRequest('/api/reminders', {
          method: 'POST',
          token,
          body: bodyPayload,
          isFormData
        });

        if (data.user) {
          setUser(data.user);
        } else {
          refreshUser();
        }

        await Promise.all([fetchReminders(), fetchLogs()]);
        return data;
      }
    } catch (err) {
      if (err.code === 'QUOTA_EXCEEDED' || err.code === 'VOICE_QUOTA_EXCEEDED') {
        throw err;
      }
      setIsOffline(true);
    }

    // Offline-First On-Device Creation (supports single or multi-time daily schedule!)
    const refNow = new Date();
    const aiParsed = parseReminderLocally(rawInput, refNow);
    const nowIso = refNow.toISOString();
    const baseTitle = (title || '').trim() || aiParsed.title;

    const effectiveMulti = Array.isArray(multiTimes) && multiTimes.length > 0
      ? multiTimes
      : (Array.isArray(aiParsed.multiTimes) && aiParsed.multiTimes.length > 1 ? aiParsed.multiTimes : []);

    const slotsToCreate = [];
    if (effectiveMulti.length > 0) {
      for (const slot of effectiveMulti) {
        const m = String(slot).trim().match(/^(\d{1,2})[:.](\d{2})(?:\s*(am|pm))?$/i);
        if (m) {
          let h = parseInt(m[1], 10);
          const mins = parseInt(m[2], 10);
          const mer = (m[3] || '').toLowerCase();
          if (mer === 'pm' && h < 12) h += 12;
          if (mer === 'am' && h === 12) h = 0;
          const d = new Date(refNow);
          d.setHours(h, mins, 0, 0);
          if (d.getTime() <= refNow.getTime()) d.setDate(d.getDate() + 1);
          slotsToCreate.push({
            iso: d.toISOString(),
            label: `${String(h).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
          });
        }
      }
    }

    if (slotsToCreate.length === 0) {
      slotsToCreate.push({ iso: scheduledAt || aiParsed.scheduledAt, label: null });
    }

    const createdLocal = [];
    let currentLogs = logs;
    const effectiveRepeat =
      slotsToCreate.length > 1 && (!repeatRule || repeatRule === 'none')
        ? 'daily'
        : (repeatRule || aiParsed.repeatRule || 'none');

    for (let idx = 0; idx < slotsToCreate.length; idx++) {
      const slotInfo = slotsToCreate[idx];
      const slotTitle =
        slotsToCreate.length > 1 && slotInfo.label
          ? `${baseTitle} (${slotInfo.label})`
          : baseTitle;

      const localReminder = {
        id: `local_rem_${Date.now()}_${idx}`,
        user_id: user?.id || 'local',
        title: slotTitle,
        raw_input: rawInput,
        input_type: inputType,
        audio_url: audioBase64 || audioFileUri || null,
        audio_duration: audioDuration || 0,
        scheduled_at: slotInfo.iso,
        status: 'pending',
        priority: priority || aiParsed.priority || 'medium',
        category: category || aiParsed.category || 'general',
        snooze_count: 0,
        repeat_rule: effectiveRepeat,
        action_link: actionLink !== undefined ? actionLink : (aiParsed.actionLink || ''),
        location_trigger: locationTrigger !== undefined ? locationTrigger : (aiParsed.locationTrigger || ''),
        subtasks_json: JSON.stringify(subtasks || []),
        assigned_to_email: assignedToEmail !== undefined ? assignedToEmail : (aiParsed.assignedToEmail || ''),
        require_proof: requireProof !== undefined ? (requireProof ? 1 : 0) : (aiParsed.requireProof ? 1 : 0),
        tts_enabled: ttsEnabled !== undefined ? (ttsEnabled ? 1 : 0) : 1,
        created_at: nowIso,
        updated_at: nowIso
      };

      createdLocal.push(localReminder);
      currentLogs = await appendLocalLog({
        reminder: localReminder,
        action: 'created',
        details: `Scheduled on-device for ${new Date(localReminder.scheduled_at).toLocaleString()} (${aiParsed.parsedTimeText})`
      });
    }

    const nextReminders = [...createdLocal, ...reminders];
    await saveLocalCache(nextReminders, currentLogs);
    return {
      reminder: createdLocal[0],
      reminders: createdLocal,
      count: createdLocal.length,
      parsed: aiParsed
    };
  }

  async function updateSubtasks(reminderId, subtasks) {
    try {
      if (token && !token.startsWith('offline-token')) {
        const data = await apiRequest(`/api/reminders/${reminderId}/subtasks`, {
          method: 'PATCH',
          token,
          body: { subtasks }
        });
        if (activeAlarm && activeAlarm.id === reminderId) {
          setActiveAlarm(data.reminder);
        }
        await fetchReminders();
        return data.reminder;
      }
    } catch (e) {}

    const nextReminders = reminders.map((r) =>
      r.id === reminderId
        ? { ...r, subtasks_json: JSON.stringify(subtasks || []) }
        : r
    );
    const updated = nextReminders.find((r) => r.id === reminderId);
    if (activeAlarm && activeAlarm.id === reminderId && updated) {
      setActiveAlarm(updated);
    }
    await saveLocalCache(nextReminders, logs);
    return updated;
  }

  async function handleReminderAction(reminderId, action, snoozeMinutes = 5) {
    stopAlarmRinging();
    if (Platform.OS !== 'web') {
      Vibration.cancel();
    }
    if (activeAlarm && activeAlarm.id === reminderId) {
      setActiveAlarm(null);
    }

    try {
      if (token && !token.startsWith('offline-token')) {
        const data = await apiRequest(`/api/reminders/${reminderId}/action`, {
          method: 'PATCH',
          token,
          body: { action, snoozeMinutes }
        });
        await Promise.all([fetchReminders(), fetchLogs(), refreshUser()]);
        return data.reminder;
      }
    } catch (e) {
      setIsOffline(true);
    }

    // Offline-First Local Action Handling
    const target = reminders.find((r) => r.id === reminderId);
    if (!target) return null;

    const now = new Date();
    let updatedRem = { ...target, updated_at: now.toISOString() };
    let logDetail = '';

    if (action === 'snooze') {
      const mins = parseInt(snoozeMinutes, 10) || 5;
      updatedRem.status = 'snoozed';
      updatedRem.scheduled_at = new Date(now.getTime() + mins * 60 * 1000).toISOString();
      updatedRem.snooze_count = (target.snooze_count || 0) + 1;
      logDetail = `Snoozed for ${mins}m (Snooze #${updatedRem.snooze_count})`;
    } else if (action === 'complete') {
      const repeatMeta = getLocalRepeatRuleMeta(target.repeat_rule);
      if (repeatMeta.isRecurring && repeatMeta.intervalMs > 0) {
        const baseTime = Math.max(now.getTime(), new Date(target.scheduled_at).getTime());
        updatedRem.status = 'pending';
        updatedRem.scheduled_at = new Date(baseTime + repeatMeta.intervalMs).toISOString();
        updatedRem.snooze_count = 0;
        logDetail = `Completed cycle! Recurring (${repeatMeta.label}) rescheduled for ${new Date(updatedRem.scheduled_at).toLocaleTimeString()}`;
      } else {
        updatedRem.status = 'completed';
        logDetail = 'Task marked as completed on device';
      }
    } else if (action === 'missed') {
      updatedRem.status = 'missed';
      logDetail = 'Alarm went unanswered past grace window';
    }

    const nextReminders = reminders.map((r) => (r.id === reminderId ? updatedRem : r));
    const nextLogs = await appendLocalLog({
      reminder: updatedRem,
      action: action === 'snooze' ? 'snoozed' : action === 'complete' ? 'completed' : action,
      details: logDetail
    });
    await saveLocalCache(nextReminders, nextLogs);
    return updatedRem;
  }

  async function deleteReminder(reminderId) {
    stopAlarmRinging();
    if (Platform.OS !== 'web') {
      Vibration.cancel();
    }
    if (activeAlarm && activeAlarm.id === reminderId) {
      setActiveAlarm(null);
    }
    if (focusTask && focusTask.id === reminderId) {
      setFocusTask(null);
    }

    try {
      if (token && !token.startsWith('offline-token')) {
        await apiRequest(`/api/reminders/${reminderId}`, {
          method: 'DELETE',
          token
        });
        await Promise.all([fetchReminders(), fetchLogs(), refreshUser()]);
        return;
      }
    } catch (e) {}

    const target = reminders.find((r) => r.id === reminderId);
    const nextReminders = reminders.filter((r) => r.id !== reminderId);
    let nextLogs = logs;
    if (target) {
      nextLogs = await appendLocalLog({
        reminder: target,
        action: 'deleted',
        details: 'Reminder deleted on device'
      });
    }
    await saveLocalCache(nextReminders, nextLogs);
  }

  async function deleteBulkReminders(reminderIds = []) {
    if (!Array.isArray(reminderIds) || reminderIds.length === 0) return;
    stopAlarmRinging();
    if (activeAlarm && reminderIds.includes(activeAlarm.id)) {
      setActiveAlarm(null);
    }
    for (const id of reminderIds) {
      try {
        if (token && !token.startsWith('offline-token')) {
          await apiRequest(`/api/reminders/${id}`, {
            method: 'DELETE',
            token
          });
        }
      } catch (e) {}
    }
    const idSet = new Set(reminderIds);
    const nextReminders = reminders.filter((r) => !idSet.has(r.id));
    await saveLocalCache(nextReminders, logs);
    if (token && !token.startsWith('offline-token')) {
      await Promise.all([fetchReminders(), fetchLogs(), refreshUser()]).catch(() => {});
    }
  }

  async function exportLogsCsv() {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const header = 'ID,Timestamp,Action,InputType,ReminderTitle,Details\n';
      const rows = logs
        .map((l) => {
          const safeTitle = `"${(l.reminder_title || '').replace(/"/g, '""')}"`;
          const safeDetails = `"${(l.details || '').replace(/"/g, '""')}"`;
          return `${l.id},${l.timestamp},${l.action},${l.input_type},${safeTitle},${safeDetails}`;
        })
        .join('\n');
      const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pulsenote_audit_logs_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  return (
    <ReminderContext.Provider
      value={{
        reminders,
        logs,
        logStats,
        analytics,
        activeAlarm,
        focusTask,
        focusDefaultMinutes,
        startFocusSession,
        closeFocusSession,
        pushStatus,
        registerBackgroundPush,
        loading,
        fetchReminders,
        fetchLogs,
        previewNaturalLanguage,
        fetchDailyBriefing,
        runAssistantCommand,
        editReminder,
        createReminder,
        updateSubtasks,
        handleReminderAction,
        deleteReminder,
        deleteBulkReminders,
        triggerAlarmNow,
        exportLogsCsv
      }}
    >
      {children}
    </ReminderContext.Provider>
  );
}

export function useReminders() {
  return useContext(ReminderContext);
}
