import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useReminders } from '../context/ReminderContext';
import { playVoiceNoteUrl, stopVoiceNotePlayback } from '../utils/sound';

const CATEGORY_COLORS = {
  health: '#34D399',
  work: '#38BDF8',
  finance: '#FBBF24',
  personal: '#F472B6',
  general: '#A5B4FC'
};

function isSameDay(d1, d2) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

/**
 * Checks if a reminder occurs on `targetDate` (either scheduled directly on that day
 * or projected via daily / hourly / custom interval repeat rules).
 * Returns an array of { hour, minute, reminder, isProjected } occurrences for that day.
 */
function getOccurrencesForDay(reminders, targetDate) {
  const occurrences = [];
  const dayStart = new Date(targetDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setHours(23, 59, 59, 999);

  for (const rem of reminders) {
    const sched = new Date(rem.scheduled_at);
    if (isNaN(sched.getTime())) continue;

    if (isSameDay(sched, targetDate)) {
      occurrences.push({
        hour: sched.getHours(),
        minute: sched.getMinutes(),
        reminder: rem,
        isProjected: false
      });
    } else if (
      (rem.status === 'pending' || rem.status === 'snoozed') &&
      rem.repeat_rule &&
      rem.repeat_rule !== 'none' &&
      dayEnd.getTime() >= sched.getTime()
    ) {
      // Project recurring daily or weekly reminders onto future days in the 7-day strip
      if (rem.repeat_rule === 'daily') {
        occurrences.push({
          hour: sched.getHours(),
          minute: sched.getMinutes(),
          reminder: rem,
          isProjected: true
        });
      } else if (
        rem.repeat_rule === 'weekly' &&
        sched.getDay() === targetDate.getDay()
      ) {
        occurrences.push({
          hour: sched.getHours(),
          minute: sched.getMinutes(),
          reminder: rem,
          isProjected: true
        });
      }
    }
  }

  occurrences.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  return occurrences;
}

export default function TimelineScreen() {
  const {
    reminders,
    createReminder,
    handleReminderAction,
    deleteReminder,
    startFocusSession,
    triggerAlarmNow
  } = useReminders();

  const [selectedDayOffset, setSelectedDayOffset] = useState(0); // 0 = Today, -1..+5
  const [quickHourSlot, setQuickHourSlot] = useState(null);
  const [quickTaskText, setQuickTaskText] = useState('');
  const [creatingSlot, setCreatingSlot] = useState(false);
  const [playingId, setPlayingId] = useState(null);

  // Build 7-day interactive week strip (-1 day to +5 days around today)
  const weekDays = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return [-1, 0, 1, 2, 3, 4, 5].map((offset) => {
      const d = new Date(today);
      d.setDate(today.getDate() + offset);
      const occ = getOccurrencesForDay(reminders, d);
      return {
        offset,
        date: d,
        dayName:
          offset === 0
            ? 'TODAY'
            : d.toLocaleDateString([], { weekday: 'short' }).toUpperCase(),
        dayNum: d.getDate(),
        monthShort: d.toLocaleDateString([], { month: 'short' }),
        count: occ.length
      };
    });
  }, [reminders]);

  const selectedDayObj =
    weekDays.find((w) => w.offset === selectedDayOffset) || weekDays[1];
  const dayOccurrences = useMemo(
    () => getOccurrencesForDay(reminders, selectedDayObj.date),
    [reminders, selectedDayObj]
  );

  // Map hours 0..23
  const hoursMap = useMemo(() => {
    const map = {};
    for (let h = 0; h < 24; h++) map[h] = [];
    for (const item of dayOccurrences) {
      if (map[item.hour]) {
        map[item.hour].push(item);
      }
    }
    return map;
  }, [dayOccurrences]);

  // Display hours 06:00 -> 23:00 plus any 00:00-05:00 hours that have scheduled alarms
  const visibleHours = useMemo(() => {
    const hrs = [];
    for (let h = 0; h < 24; h++) {
      if (h >= 6 || (hoursMap[h] && hoursMap[h].length > 0)) {
        hrs.push(h);
      }
    }
    return hrs;
  }, [hoursMap]);

  const busyHoursCount = visibleHours.filter(
    (h) => hoursMap[h] && hoursMap[h].length > 0
  ).length;
  const freeHoursCount = Math.max(0, visibleHours.length - busyHoursCount);
  const currentHour = new Date().getHours();

  const handleQuickScheduleAtHour = async (hour) => {
    if (!quickTaskText.trim()) return;
    setCreatingSlot(true);
    try {
      const target = new Date(selectedDayObj.date);
      target.setHours(hour, 0, 0, 0);
      if (target.getTime() <= Date.now()) {
        target.setTime(Date.now() + 60 * 1000);
      }
      await createReminder({
        rawInput: `${quickTaskText.trim()} at ${String(hour).padStart(2, '0')}:00`,
        title: quickTaskText.trim(),
        scheduledAt: target.toISOString(),
        inputType: 'text'
      });
      setQuickTaskText('');
      setQuickHourSlot(null);
    } catch (e) {
    } finally {
      setCreatingSlot(false);
    }
  };

  const handleTogglePlay = async (rem) => {
    if (playingId === rem.id) {
      await stopVoiceNotePlayback();
      setPlayingId(null);
      return;
    }
    setPlayingId(rem.id);
    await playVoiceNoteUrl(rem.audio_url, () => setPlayingId(null));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Top Banner */}
      <View style={styles.headerCard}>
        <View style={styles.headerTitleRow}>
          <Ionicons name="calendar" size={22} color="#38BDF8" />
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>
              Visual Calendar & 24-Hour Day Timeline
            </Text>
            <Text style={styles.headerSub}>
              Inspect hourly workload, multi-time daily slots, and free deep-work blocks
            </Text>
          </View>
        </View>

        {/* 7-Day Interactive Week Strip */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: 14 }}
        >
          <View style={styles.weekRow}>
            {weekDays.map((wd) => {
              const active = wd.offset === selectedDayOffset;
              return (
                <TouchableOpacity
                  key={wd.offset}
                  style={[styles.dayPill, active && styles.dayPillActive]}
                  onPress={() => setSelectedDayOffset(wd.offset)}
                >
                  <Text
                    style={[
                      styles.dayNameText,
                      active && { color: '#FFFFFF', fontWeight: '800' }
                    ]}
                  >
                    {wd.dayName}
                  </Text>
                  <Text
                    style={[
                      styles.dayNumText,
                      active && { color: '#FFFFFF' }
                    ]}
                  >
                    {wd.dayNum}
                  </Text>
                  <Text
                    style={[
                      styles.dayMonthText,
                      active && { color: '#E0E7FF' }
                    ]}
                  >
                    {wd.monthShort}
                  </Text>
                  <View
                    style={[
                      styles.dayCountBadge,
                      wd.count > 0
                        ? { backgroundColor: active ? '#34D399' : '#4F46E5' }
                        : { backgroundColor: '#1E293B' }
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayCountText,
                        wd.count > 0 && active && { color: '#064E3B' }
                      ]}
                    >
                      {wd.count}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>

        {/* Summary Metrics for Selected Day */}
        <View style={styles.metricsRow}>
          <View style={styles.metricBox}>
            <Text style={styles.metricVal}>{dayOccurrences.length}</Text>
            <Text style={styles.metricLabel}>Scheduled Slots</Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={[styles.metricVal, { color: '#F472B6' }]}>
              {busyHoursCount}h
            </Text>
            <Text style={styles.metricLabel}>Busy Hours</Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={[styles.metricVal, { color: '#34D399' }]}>
              {freeHoursCount}h
            </Text>
            <Text style={styles.metricLabel}>Free Focus Blocks</Text>
          </View>
        </View>
      </View>

      {/* 24-Hour Visual Schedule Timeline */}
      <Text style={styles.sectionHeader}>
        HOURLY TIMELINE FOR{' '}
        {selectedDayObj.date
          .toLocaleDateString([], {
            weekday: 'long',
            month: 'short',
            day: 'numeric'
          })
          .toUpperCase()}
      </Text>

      <View style={styles.timelineList}>
        {visibleHours.map((hour) => {
          const items = hoursMap[hour] || [];
          const isCurrentHour =
            selectedDayOffset === 0 && currentHour === hour;
          const hourLabel = `${String(hour).padStart(2, '0')}:00`;
          const ampmLabel =
            hour === 0
              ? '12 AM'
              : hour < 12
              ? `${hour} AM`
              : hour === 12
              ? '12 PM'
              : `${hour - 12} PM`;

          return (
            <View
              key={hour}
              style={[
                styles.hourRow,
                isCurrentHour && styles.hourRowCurrent
              ]}
            >
              {/* Left Time Gutter */}
              <View style={styles.timeGutter}>
                <Text
                  style={[
                    styles.hourText,
                    isCurrentHour && { color: '#38BDF8', fontWeight: '900' }
                  ]}
                >
                  {hourLabel}
                </Text>
                <Text style={styles.ampmText}>{ampmLabel}</Text>
                {isCurrentHour && (
                  <View style={styles.nowPill}>
                    <Text style={styles.nowPillText}>NOW</Text>
                  </View>
                )}
              </View>

              {/* Right Slot Track */}
              <View style={styles.slotContent}>
                {items.length > 0 ? (
                  items.map((occ, idx) => {
                    const rem = occ.reminder;
                    const catColor =
                      CATEGORY_COLORS[rem.category || 'general'] || '#A5B4FC';
                    const timeStr = `${String(occ.hour).padStart(2, '0')}:${String(
                      occ.minute
                    ).padStart(2, '0')}`;

                    return (
                      <View
                        key={`${rem.id}_${idx}`}
                        style={[
                          styles.slotCard,
                          { borderLeftColor: catColor },
                          rem.status === 'completed' && { opacity: 0.6 }
                        ]}
                      >
                        <View style={styles.slotTopRow}>
                          <View style={styles.slotTimeChip}>
                            <Ionicons name="alarm" size={12} color={catColor} />
                            <Text
                              style={[styles.slotTimeText, { color: catColor }]}
                            >
                              {timeStr}
                            </Text>
                          </View>

                          <Text style={styles.slotCatTag}>
                            {(rem.category || 'general').toUpperCase()}
                          </Text>

                          {occ.isProjected && (
                            <Text style={styles.projectedTag}>
                              ↻ RECURRING SLOT
                            </Text>
                          )}

                          <Text
                            style={[
                              styles.slotStatusTag,
                              rem.status === 'completed' && { color: '#34D399' },
                              rem.status === 'missed' && { color: '#F87171' }
                            ]}
                          >
                            {rem.status.toUpperCase()}
                          </Text>
                        </View>

                        <Text style={styles.slotTitle}>{rem.title}</Text>

                        <View style={styles.slotActionsRow}>
                          <TouchableOpacity
                            style={styles.focusChip}
                            onPress={() => startFocusSession(rem, 25)}
                          >
                            <Ionicons
                              name="timer-outline"
                              size={14}
                              color="#F472B6"
                            />
                            <Text style={styles.focusChipText}>
                              🎯 Focus 25m
                            </Text>
                          </TouchableOpacity>

                          {rem.audio_url && (
                            <TouchableOpacity
                              style={styles.actionSmallChip}
                              onPress={() => handleTogglePlay(rem)}
                            >
                              <Ionicons
                                name={
                                  playingId === rem.id
                                    ? 'stop-circle'
                                    : 'play-circle'
                                }
                                size={14}
                                color="#38BDF8"
                              />
                              <Text style={styles.actionSmallText}>
                                {playingId === rem.id ? 'Stop' : 'Voice'}
                              </Text>
                            </TouchableOpacity>
                          )}

                          {rem.status !== 'completed' && (
                            <TouchableOpacity
                              style={styles.doneSmallChip}
                              onPress={() =>
                                handleReminderAction(rem.id, 'complete')
                              }
                            >
                              <Ionicons
                                name="checkmark-circle"
                                size={14}
                                color="#34D399"
                              />
                              <Text style={styles.doneSmallText}>Done</Text>
                            </TouchableOpacity>
                          )}

                          <TouchableOpacity
                            style={styles.actionSmallChip}
                            onPress={() => triggerAlarmNow(rem)}
                          >
                            <Ionicons
                              name="notifications"
                              size={13}
                              color="#FBBF24"
                            />
                            <Text style={styles.actionSmallText}>Ring</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[
                              styles.actionSmallChip,
                              {
                                backgroundColor: 'rgba(239, 68, 68, 0.16)',
                                borderColor: 'rgba(239, 68, 68, 0.45)'
                              }
                            ]}
                            onPress={() => deleteReminder(rem.id)}
                          >
                            <Ionicons
                              name="trash-outline"
                              size={13}
                              color="#F87171"
                            />
                            <Text
                              style={[
                                styles.actionSmallText,
                                { color: '#FCA5A5', fontWeight: '700' }
                              ]}
                            >
                              Delete
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })
                ) : (
                  <View style={styles.freeSlotBox}>
                    {quickHourSlot === hour ? (
                      <View style={styles.quickAddRow}>
                        <TextInput
                          style={styles.quickAddInput}
                          placeholder={`Schedule task at ${hourLabel}...`}
                          placeholderTextColor="#64748B"
                          value={quickTaskText}
                          onChangeText={setQuickTaskText}
                          autoFocus
                        />
                        <TouchableOpacity
                          style={styles.quickSaveBtn}
                          onPress={() => handleQuickScheduleAtHour(hour)}
                          disabled={creatingSlot}
                        >
                          <Text style={styles.quickSaveText}>
                            {creatingSlot ? '...' : 'Add'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.quickCancelBtn}
                          onPress={() => {
                            setQuickHourSlot(null);
                            setQuickTaskText('');
                          }}
                        >
                          <Ionicons name="close" size={16} color="#94A3B8" />
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.freeSlotTouch}
                        onPress={() => {
                          setQuickHourSlot(hour);
                          setQuickTaskText('');
                        }}
                      >
                        <Text style={styles.freeSlotText}>
                          Free Focus Block • + Tap to schedule at {hourLabel}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A'
  },
  content: {
    padding: 16,
    paddingBottom: 40
  },
  headerCard: {
    backgroundColor: '#1E293B',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 18
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  headerTitle: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '800'
  },
  headerSub: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2
  },
  weekRow: {
    flexDirection: 'row',
    gap: 10
  },
  dayPill: {
    width: 68,
    backgroundColor: '#0F172A',
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155'
  },
  dayPillActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#818CF8'
  },
  dayNameText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700'
  },
  dayNumText: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '900',
    marginVertical: 2
  },
  dayMonthText: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '600'
  },
  dayCountBadge: {
    marginTop: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999
  },
  dayCountText: {
    color: '#E2E8F0',
    fontSize: 10,
    fontWeight: '800'
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14
  },
  metricBox: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155'
  },
  metricVal: {
    color: '#38BDF8',
    fontSize: 18,
    fontWeight: '900'
  },
  metricLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2
  },
  sectionHeader: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 10
  },
  timelineList: {
    gap: 8
  },
  hourRow: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 10,
    minHeight: 64
  },
  hourRowCurrent: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.07)'
  },
  timeGutter: {
    width: 68,
    borderRightWidth: 1,
    borderRightColor: '#334155',
    paddingRight: 8,
    justifyContent: 'center'
  },
  hourText: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '800'
  },
  ampmText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600'
  },
  nowPill: {
    marginTop: 4,
    backgroundColor: '#0284C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start'
  },
  nowPillText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900'
  },
  slotContent: {
    flex: 1,
    paddingLeft: 10,
    justifyContent: 'center',
    gap: 8
  },
  slotCard: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 10,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: '#334155'
  },
  slotTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4
  },
  slotTimeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  slotTimeText: {
    fontSize: 12,
    fontWeight: '800'
  },
  slotCatTag: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '800'
  },
  projectedTag: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '700'
  },
  slotStatusTag: {
    color: '#FBBF24',
    fontSize: 10,
    fontWeight: '800',
    marginLeft: 'auto'
  },
  slotTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8
  },
  slotActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6
  },
  focusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(244, 114, 182, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(244, 114, 182, 0.4)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8
  },
  focusChipText: {
    color: '#F472B6',
    fontSize: 11,
    fontWeight: '700'
  },
  doneSmallChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(52, 211, 153, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.4)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8
  },
  doneSmallText: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: '700'
  },
  actionSmallChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8
  },
  actionSmallText: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '600'
  },
  freeSlotBox: {
    justifyContent: 'center'
  },
  freeSlotTouch: {
    paddingVertical: 6
  },
  freeSlotText: {
    color: '#475569',
    fontSize: 12,
    fontStyle: 'italic'
  },
  quickAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  quickAddInput: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#4F46E5',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: '#FFFFFF',
    fontSize: 12
  },
  quickSaveBtn: {
    backgroundColor: '#4F46E5',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8
  },
  quickSaveText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700'
  },
  quickCancelBtn: {
    padding: 4
  }
});
