import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useReminders } from '../context/ReminderContext';
import {
  startFocusAmbientSound,
  stopFocusAmbientSound,
  playFocusCompleteChime,
  speakTextAloud
} from '../utils/sound';

const DURATION_PRESETS = [
  { mins: 15, label: '15m Sprint' },
  { mins: 25, label: '25m Pomodoro' },
  { mins: 45, label: '45m Deep Work' },
  { mins: 5, label: '5m Rest Break' }
];

const AMBIENT_MODES = [
  { key: 'off', label: 'Silent', icon: 'volume-mute' },
  { key: 'tick', label: 'Soft Metronome Tick', icon: 'stopwatch' },
  { key: 'rain', label: 'Soothing Rain Noise', icon: 'rainy' }
];

export default function FocusTimerModal() {
  const {
    focusTask,
    focusDefaultMinutes,
    closeFocusSession,
    handleReminderAction,
    updateSubtasks
  } = useReminders();

  const [selectedMinutes, setSelectedMinutes] = useState(25);
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [ambientMode, setAmbientMode] = useState('off');
  const [sessionFinished, setSessionFinished] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (focusTask) {
      const mins = focusDefaultMinutes || 25;
      setSelectedMinutes(mins);
      setSecondsLeft(mins * 60);
      setIsRunning(true);
      setSessionFinished(false);
      setAmbientMode('tick');
      startFocusAmbientSound('tick');
    } else {
      setIsRunning(false);
      stopFocusAmbientSound();
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stopFocusAmbientSound();
    };
  }, [focusTask?.id]);

  useEffect(() => {
    if (!focusTask || !isRunning) {
      if (timerRef.current) clearInterval(timerRef.current);
      stopFocusAmbientSound();
      return;
    }

    if (ambientMode !== 'off') {
      startFocusAmbientSound(ambientMode);
    } else {
      stopFocusAmbientSound();
    }

    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setIsRunning(false);
          setSessionFinished(true);
          playFocusCompleteChime();
          speakTextAloud(
            `Pomodoro focus session complete for ${focusTask.title}. Great job!`
          );
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [focusTask?.id, isRunning, ambientMode]);

  if (!focusTask) return null;

  const totalSecs = selectedMinutes * 60;
  const elapsedSecs = Math.max(0, totalSecs - secondsLeft);
  const progressPct = totalSecs > 0 ? Math.min(100, Math.round((elapsedSecs / totalSecs) * 100)) : 0;

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  let subtasks = [];
  try {
    subtasks = JSON.parse(focusTask.subtasks_json || '[]');
  } catch (e) {
    subtasks = [];
  }

  const handleSelectDuration = (mins) => {
    setSelectedMinutes(mins);
    setSecondsLeft(mins * 60);
    setSessionFinished(false);
    setIsRunning(true);
  };

  const handleToggleSubtask = async (idx) => {
    const next = subtasks.map((item, i) =>
      i === idx ? { ...item, done: !item.done } : item
    );
    await updateSubtasks(focusTask.id, next);
  };

  const handleCompleteAndClose = async () => {
    stopFocusAmbientSound();
    await handleReminderAction(focusTask.id, 'complete');
    closeFocusSession();
  };

  return (
    <Modal visible={!!focusTask} animationType="fade" transparent={true}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <ScrollView contentContainerStyle={styles.cardScroll}>
            {/* Header */}
            <View style={styles.headerRow}>
              <View style={styles.focusBadge}>
                <Ionicons name="flame" size={15} color="#F472B6" />
                <Text style={styles.focusBadgeText}>
                  POMODORO DEEP-WORK FOCUS MODE
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeIconBtn}
                onPress={() => {
                  stopFocusAmbientSound();
                  closeFocusSession();
                }}
              >
                <Ionicons name="close" size={22} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <Text style={styles.taskTitle}>{focusTask.title}</Text>
            <Text style={styles.taskRaw}>"{focusTask.raw_input}"</Text>

            {/* Duration Presets */}
            <View style={styles.presetsRow}>
              {DURATION_PRESETS.map((d) => {
                const active = selectedMinutes === d.mins;
                return (
                  <TouchableOpacity
                    key={d.mins}
                    style={[styles.presetChip, active && styles.presetChipActive]}
                    onPress={() => handleSelectDuration(d.mins)}
                  >
                    <Text
                      style={[
                        styles.presetChipText,
                        active && styles.presetChipTextActive
                      ]}
                    >
                      {d.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Countdown Clock Circle */}
            <View style={styles.clockCircle}>
              <Text style={styles.clockTimeText}>
                {mm}:{ss}
              </Text>
              <Text style={styles.clockSubText}>
                {sessionFinished
                  ? '🎉 FOCUS SESSION COMPLETE!'
                  : isRunning
                  ? `FOCUSING • ${progressPct}% DONE`
                  : 'TIMER PAUSED'}
              </Text>
              <View style={styles.progressTrack}>
                <View
                  style={[styles.progressFill, { width: `${progressPct}%` }]}
                />
              </View>
            </View>

            {/* Play / Pause / Reset Controls */}
            <View style={styles.controlsRow}>
              <TouchableOpacity
                style={[
                  styles.controlBtn,
                  isRunning ? styles.pauseBtn : styles.startBtn
                ]}
                onPress={() => setIsRunning(!isRunning)}
              >
                <Ionicons
                  name={isRunning ? 'pause' : 'play'}
                  size={20}
                  color="#FFFFFF"
                />
                <Text style={styles.controlBtnText}>
                  {isRunning ? 'Pause Timer' : 'Resume Focus'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.resetBtn}
                onPress={() => {
                  setIsRunning(false);
                  setSessionFinished(false);
                  setSecondsLeft(selectedMinutes * 60);
                }}
              >
                <Ionicons name="refresh" size={18} color="#CBD5E1" />
                <Text style={styles.resetBtnText}>Reset</Text>
              </TouchableOpacity>
            </View>

            {/* Ambient Focus Sound Selector */}
            <View style={styles.ambientBox}>
              <Text style={styles.ambientLabel}>
                AMBIENT DEEP-WORK AUDIO SYNTHESIZER:
              </Text>
              <View style={styles.ambientRow}>
                {AMBIENT_MODES.map((m) => {
                  const active = ambientMode === m.key;
                  return (
                    <TouchableOpacity
                      key={m.key}
                      style={[
                        styles.ambientChip,
                        active && styles.ambientChipActive
                      ]}
                      onPress={() => setAmbientMode(m.key)}
                    >
                      <Ionicons
                        name={m.icon}
                        size={14}
                        color={active ? '#FFFFFF' : '#94A3B8'}
                      />
                      <Text
                        style={[
                          styles.ambientChipText,
                          active && { color: '#FFFFFF', fontWeight: '700' }
                        ]}
                      >
                        {m.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Sub-checklist if available */}
            {subtasks.length > 0 && (
              <View style={styles.subtasksBox}>
                <Text style={styles.ambientLabel}>SESSION SUB-CHECKLIST:</Text>
                {subtasks.map((st, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={styles.subtaskRow}
                    onPress={() => handleToggleSubtask(idx)}
                  >
                    <Ionicons
                      name={st.done ? 'checkbox' : 'square-outline'}
                      size={18}
                      color={st.done ? '#34D399' : '#94A3B8'}
                    />
                    <Text
                      style={[
                        styles.subtaskText,
                        st.done && {
                          textDecorationLine: 'line-through',
                          color: '#64748B'
                        }
                      ]}
                    >
                      {st.text}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Finish & Mark Reminder Done Button */}
            <TouchableOpacity
              style={styles.completeTaskBtn}
              onPress={handleCompleteAndClose}
            >
              <Ionicons name="checkmark-done-circle" size={22} color="#064E3B" />
              <Text style={styles.completeTaskBtnText}>
                Complete Focus Session & Mark Task Done
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16
  },
  card: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '92%',
    backgroundColor: '#1E293B',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#334155',
    overflow: 'hidden'
  },
  cardScroll: {
    padding: 20,
    alignItems: 'center'
  },
  headerRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12
  },
  focusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(244, 114, 182, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(244, 114, 182, 0.4)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999
  },
  focusBadgeText: {
    color: '#F472B6',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6
  },
  closeIconBtn: {
    padding: 4
  },
  taskTitle: {
    color: '#F8FAFC',
    fontSize: 21,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 4
  },
  taskRaw: {
    color: '#94A3B8',
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: 16
  },
  presetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginBottom: 18
  },
  presetChip: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999
  },
  presetChipActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#818CF8'
  },
  presetChipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600'
  },
  presetChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '800'
  },
  clockCircle: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: '#0F172A',
    borderWidth: 4,
    borderColor: '#6366F1',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    marginBottom: 18
  },
  clockTimeText: {
    color: '#FFFFFF',
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: 1.5
  },
  clockSubText: {
    color: '#A5B4FC',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 6,
    letterSpacing: 0.6,
    textAlign: 'center'
  },
  progressTrack: {
    width: '78%',
    height: 6,
    backgroundColor: '#1E293B',
    borderRadius: 999,
    marginTop: 12,
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#34D399',
    borderRadius: 999
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 18
  },
  controlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 12
  },
  startBtn: {
    backgroundColor: '#4F46E5'
  },
  pauseBtn: {
    backgroundColor: '#D97706'
  },
  controlBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800'
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#334155',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 12
  },
  resetBtnText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '700'
  },
  ambientBox: {
    width: '100%',
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 14
  },
  ambientLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    marginBottom: 8
  },
  ambientRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  ambientChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999
  },
  ambientChipActive: {
    backgroundColor: '#0284C7',
    borderColor: '#38BDF8'
  },
  ambientChipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600'
  },
  subtasksBox: {
    width: '100%',
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 14
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5
  },
  subtaskText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '600'
  },
  completeTaskBtn: {
    width: '100%',
    backgroundColor: '#34D399',
    paddingVertical: 14,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  completeTaskBtnText: {
    color: '#064E3B',
    fontSize: 15,
    fontWeight: '800'
  }
});
