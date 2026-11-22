import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useReminders } from '../context/ReminderContext';
import { playVoiceNoteUrl, stopVoiceNotePlayback } from '../utils/sound';

const FILTERS = [
  { key: 'all', label: 'All Events' },
  { key: 'created', label: 'Created' },
  { key: 'triggered', label: 'Triggered' },
  { key: 'snoozed', label: 'Snoozed' },
  { key: 'completed', label: 'Completed' },
  { key: 'missed', label: 'Missed' }
];

const ACTION_META = {
  created: { icon: 'add-circle', color: '#818CF8', bg: 'rgba(129,140,248,0.14)' },
  triggered: { icon: 'notifications', color: '#FBBF24', bg: 'rgba(251,191,36,0.14)' },
  snoozed: { icon: 'time', color: '#F59E0B', bg: 'rgba(245,158,11,0.14)' },
  completed: { icon: 'checkmark-done-circle', color: '#34D399', bg: 'rgba(52,211,153,0.14)' },
  missed: { icon: 'alert-circle', color: '#F87171', bg: 'rgba(248,113,113,0.14)' },
  deleted: { icon: 'trash', color: '#94A3B8', bg: 'rgba(148,163,184,0.14)' }
};

export default function LogsScreen() {
  const { logs, logStats, analytics, fetchLogs, exportLogsCsv } = useReminders();
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [playingLogId, setPlayingLogId] = useState(null);

  useEffect(() => {
    fetchLogs(selectedFilter);
    return () => {
      stopVoiceNotePlayback();
    };
  }, [selectedFilter]);

  async function handlePlayLogAudio(logItem) {
    if (playingLogId === logItem.id) {
      await stopVoiceNotePlayback();
      setPlayingLogId(null);
      return;
    }
    setPlayingLogId(logItem.id);
    await playVoiceNoteUrl(logItem.audio_url, () => {
      setPlayingLogId(null);
    });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.pageTitle}>Analytics & Audit Log</Text>
          <Text style={styles.pageSub}>
            Habit streaks, completion rates, category insights, and voice/text audit history.
          </Text>
        </View>
        <TouchableOpacity style={styles.exportCsvBtn} onPress={exportLogsCsv}>
          <Ionicons name="download-outline" size={16} color="#FFFFFF" />
          <Text style={styles.exportCsvText}>Export CSV</Text>
        </TouchableOpacity>
      </View>

      {/* Productivity Streak & Completion Rate Banner */}
      <View style={styles.analyticsCard}>
        <View style={styles.analyticsMetric}>
          <View style={styles.streakCircle}>
            <Ionicons name="flame" size={24} color="#F59E0B" />
          </View>
          <View>
            <Text style={styles.analyticsValue}>{analytics?.streakDays || 1} Days</Text>
            <Text style={styles.analyticsLabel}>Active Habit Streak</Text>
          </View>
        </View>

        <View style={styles.analyticsMetric}>
          <View style={[styles.streakCircle, { backgroundColor: 'rgba(52,211,153,0.15)' }]}>
            <Ionicons name="pie-chart" size={22} color="#34D399" />
          </View>
          <View>
            <Text style={[styles.analyticsValue, { color: '#34D399' }]}>
              {analytics?.completionRate ?? 100}%
            </Text>
            <Text style={styles.analyticsLabel}>On-Time Completion</Text>
          </View>
        </View>
      </View>

      {/* Category Breakdown & Most Snoozed */}
      {(analytics?.categories?.length > 0 || analytics?.mostSnoozed?.length > 0) && (
        <View style={styles.breakdownCard}>
          {analytics?.categories?.length > 0 && (
            <View style={{ marginBottom: analytics?.mostSnoozed?.length ? 12 : 0 }}>
              <Text style={styles.breakdownHeader}>TASKS BY CATEGORY</Text>
              <View style={styles.catDistRow}>
                {analytics.categories.map((c, idx) => (
                  <View key={idx} style={styles.catDistChip}>
                    <Text style={styles.catDistName}>
                      {(c.category || 'general').toUpperCase()}
                    </Text>
                    <Text style={styles.catDistCount}>{c.count}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {analytics?.mostSnoozed?.length > 0 && (
            <View>
              <Text style={styles.breakdownHeader}>MOST SNOOZED REMINDERS</Text>
              {analytics.mostSnoozed.map((ms) => (
                <View key={ms.id} style={styles.snoozedRankRow}>
                  <Text style={styles.snoozedRankTitle}>{ms.title}</Text>
                  <Text style={styles.snoozedRankCount}>
                    Snoozed {ms.snooze_count}x
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Summary KPI Cards */}
      <View style={styles.statsGrid}>
        <View style={styles.statBox}>
          <Text style={[styles.statNumber, { color: '#818CF8' }]}>
            {logStats.created || 0}
          </Text>
          <Text style={styles.statLabel}>Created</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statNumber, { color: '#FBBF24' }]}>
            {logStats.triggered || 0}
          </Text>
          <Text style={styles.statLabel}>Rang</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statNumber, { color: '#F59E0B' }]}>
            {logStats.snoozed || 0}
          </Text>
          <Text style={styles.statLabel}>Snoozed</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statNumber, { color: '#34D399' }]}>
            {logStats.completed || 0}
          </Text>
          <Text style={styles.statLabel}>Completed</Text>
        </View>
      </View>

      {/* Filter Bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
      >
        <View style={styles.filterRow}>
          {FILTERS.map((f) => {
            const active = selectedFilter === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setSelectedFilter(f.key)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    active && styles.filterChipTextActive
                  ]}
                >
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Timeline Entries */}
      {logs.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="document-text-outline" size={40} color="#475569" />
          <Text style={styles.emptyTitle}>No log events found</Text>
          <Text style={styles.emptySub}>
            Create or trigger a reminder alarm to see real-time audit logs here.
          </Text>
        </View>
      ) : (
        logs.map((item) => {
          const meta = ACTION_META[item.action] || ACTION_META.created;
          return (
            <View key={item.id} style={styles.logCard}>
              <View style={[styles.iconWrap, { backgroundColor: meta.bg }]}>
                <Ionicons name={meta.icon} size={22} color={meta.color} />
              </View>

              <View style={styles.logBody}>
                <View style={styles.logHeaderRow}>
                  <View style={styles.actionBadges}>
                    <Text style={[styles.actionTag, { color: meta.color }]}>
                      {item.action.toUpperCase()}
                    </Text>
                    <View style={styles.inputTypeTag}>
                      <Ionicons
                        name={
                          item.input_type === 'voice'
                            ? 'mic'
                            : 'chatbubble-ellipses'
                        }
                        size={11}
                        color="#CBD5E1"
                      />
                      <Text style={styles.inputTypeTagText}>
                        {item.input_type === 'voice' ? 'VOICE' : 'TEXT'}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.timestampText}>
                    {new Date(item.timestamp).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit'
                    })}
                  </Text>
                </View>

                <Text style={styles.logTitle}>{item.reminder_title}</Text>
                {item.details ? (
                  <Text style={styles.logDetails}>{item.details}</Text>
                ) : null}

                {item.audio_url ? (
                  <TouchableOpacity
                    style={styles.audioReplayBtn}
                    onPress={() => handlePlayLogAudio(item)}
                  >
                    <Ionicons
                      name={
                        playingLogId === item.id ? 'stop-circle' : 'play-circle'
                      }
                      size={18}
                      color="#F472B6"
                    />
                    <Text style={styles.audioReplayText}>
                      {playingLogId === item.id
                        ? 'Stop Voice Note'
                        : 'Replay Recorded Voice Note'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A'
  },
  content: {
    padding: 18,
    paddingBottom: 40,
    maxWidth: 780,
    width: '100%',
    alignSelf: 'center'
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14
  },
  pageTitle: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4
  },
  pageSub: {
    color: '#94A3B8',
    fontSize: 13
  },
  exportCsvBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#4F46E5',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12
  },
  exportCsvText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700'
  },
  analyticsCard: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 16
  },
  analyticsMetric: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  streakCircle: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: 'rgba(245,158,11,0.16)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  analyticsValue: {
    color: '#FBBF24',
    fontSize: 20,
    fontWeight: '800'
  },
  analyticsLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600'
  },
  breakdownCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155'
  },
  breakdownHeader: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 8
  },
  catDistRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  catDistChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155'
  },
  catDistName: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '700'
  },
  catDistCount: {
    color: '#818CF8',
    fontSize: 12,
    fontWeight: '800'
  },
  snoozedRankRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4
  },
  snoozedRankTitle: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600'
  },
  snoozedRankCount: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '700'
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18
  },
  statBox: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155'
  },
  statNumber: {
    fontSize: 22,
    fontWeight: '800'
  },
  statLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2
  },
  filterScroll: {
    marginBottom: 16
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8
  },
  filterChip: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155'
  },
  filterChipActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#6366F1'
  },
  filterChipText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600'
  },
  filterChipTextActive: {
    color: '#FFFFFF'
  },
  emptyBox: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155'
  },
  emptyTitle: {
    color: '#E2E8F0',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 10
  },
  emptySub: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4
  },
  logCard: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 12
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  logBody: {
    flex: 1
  },
  logHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 4
  },
  actionBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  actionTag: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6
  },
  inputTypeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0F172A',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6
  },
  inputTypeTagText: {
    color: '#CBD5E1',
    fontSize: 10,
    fontWeight: '700'
  },
  timestampText: {
    color: '#64748B',
    fontSize: 11
  },
  logTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2
  },
  logDetails: {
    color: '#94A3B8',
    fontSize: 13
  },
  audioReplayBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(244,114,182,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8
  },
  audioReplayText: {
    color: '#F472B6',
    fontSize: 12,
    fontWeight: '700'
  }
});
