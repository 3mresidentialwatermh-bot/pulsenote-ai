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
  const [loading, setLoading] = useState(false);

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
          if (now - scheduledTime > 30 * 60 * 1000) {
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
    startAlarmRinging(reminder, user?.name || '');
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

  async function previewNaturalLanguage(text) {
    if (!text.trim()) return null;
    try {
      if (token && !token.startsWith('offline-token')) {
        const data = await apiRequest('/api/reminders/parse', {
          method: 'POST',
          token,
          body: {
            text,
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

  async function createReminder({
    rawInput,
    title,
    scheduledAt,
    priority,
    category,
    repeatRule,
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
    audioFileUri = null
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
          if (priority) formData.append('priority', priority);
          if (category) formData.append('category', category);
          if (repeatRule) formData.append('repeatRule', repeatRule);
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
            priority,
            category,
            repeatRule,
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

    // Offline-First On-Device Creation!
    const aiParsed = parseReminderLocally(rawInput, new Date());
    const nowIso = new Date().toISOString();
    const localReminder = {
      id: `local_rem_${Date.now()}`,
      user_id: user?.id || 'local',
      title: (title || '').trim() || aiParsed.title,
      raw_input: rawInput,
      input_type: inputType,
      audio_url: audioBase64 || audioFileUri || null,
      audio_duration: audioDuration || 0,
      scheduled_at: scheduledAt || aiParsed.scheduledAt,
      status: 'pending',
      priority: priority || aiParsed.priority || 'medium',
      category: category || aiParsed.category || 'general',
      snooze_count: 0,
      repeat_rule: repeatRule || aiParsed.repeatRule || 'none',
      action_link: actionLink !== undefined ? actionLink : (aiParsed.actionLink || ''),
      location_trigger: locationTrigger !== undefined ? locationTrigger : (aiParsed.locationTrigger || ''),
      subtasks_json: JSON.stringify(subtasks || []),
      assigned_to_email: assignedToEmail !== undefined ? assignedToEmail : (aiParsed.assignedToEmail || ''),
      require_proof: requireProof !== undefined ? (requireProof ? 1 : 0) : (aiParsed.requireProof ? 1 : 0),
      tts_enabled: ttsEnabled !== undefined ? (ttsEnabled ? 1 : 0) : 1,
      created_at: nowIso,
      updated_at: nowIso
    };

    const nextReminders = [localReminder, ...reminders];
    const nextLogs = await appendLocalLog({
      reminder: localReminder,
      action: 'created',
      details: `Scheduled on-device for ${new Date(localReminder.scheduled_at).toLocaleString()} (${aiParsed.parsedTimeText})`
    });

    await saveLocalCache(nextReminders, nextLogs);
    return { reminder: localReminder, parsed: aiParsed };
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
        loading,
        fetchReminders,
        fetchLogs,
        previewNaturalLanguage,
        createReminder,
        updateSubtasks,
        handleReminderAction,
        deleteReminder,
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
