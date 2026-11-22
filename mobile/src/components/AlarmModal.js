import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Linking,
  ScrollView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useReminders } from '../context/ReminderContext';
import { playVoiceNoteUrl, stopVoiceNotePlayback, speakReminderTTS } from '../utils/sound';

export default function AlarmModal() {
  const { user } = useAuth();
  const { activeAlarm, handleReminderAction, updateSubtasks } = useReminders();
  const [playingVoice, setPlayingVoice] = useState(false);
  const [challengeAnswer, setChallengeAnswer] = useState('');
  const [challengeError, setChallengeError] = useState('');
  const [mathNums, setMathNums] = useState({ a: 7, b: 8 });
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (activeAlarm) {
      setChallengeAnswer('');
      setChallengeError('');
      setMathNums({
        a: Math.floor(Math.random() * 8) + 3,
        b: Math.floor(Math.random() * 8) + 4
      });

      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.14,
            duration: 500,
            useNativeDriver: true
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true
          })
        ])
      );
      loop.start();
      return () => {
        loop.stop();
        stopVoiceNotePlayback();
        setPlayingVoice(false);
      };
    }
  }, [activeAlarm?.id]);

  if (!activeAlarm) return null;

  const isVoice = activeAlarm.input_type === 'voice';
  const needsProof = !!activeAlarm.require_proof || activeAlarm.priority === 'high';
  let subtasks = [];
  try {
    subtasks = JSON.parse(activeAlarm.subtasks_json || '[]');
  } catch (e) {
    subtasks = [];
  }

  const handlePlayVoice = async () => {
    if (playingVoice) {
      await stopVoiceNotePlayback();
      setPlayingVoice(false);
      return;
    }
    setPlayingVoice(true);
    await playVoiceNoteUrl(activeAlarm.audio_url, () => {
      setPlayingVoice(false);
    });
  };

  const handleToggleSubtask = async (idx) => {
    const next = subtasks.map((item, i) =>
      i === idx ? { ...item, done: !item.done } : item
    );
    await updateSubtasks(activeAlarm.id, next);
  };

  const handleCompleteDismiss = () => {
    if (needsProof) {
      const expected = String(mathNums.a + mathNums.b);
      if (challengeAnswer.trim() !== expected) {
        setChallengeError(`Wake-Up Verification required! Solve ${mathNums.a} + ${mathNums.b} = ${expected} to dismiss.`);
        return;
      }
    }
    handleReminderAction(activeAlarm.id, 'complete');
  };

  return (
    <Modal visible={!!activeAlarm} animationType="slide" transparent={false}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.topBadge}>
          <Ionicons name="notifications" size={16} color="#FDE68A" />
          <Text style={styles.topBadgeText}>
            ALARM RINGING • {isVoice ? 'VOICE NOTE' : 'TEXT'} • {(activeAlarm.category || 'general').toUpperCase()}
          </Text>
        </View>

        <Animated.View style={[styles.bellCircle, { transform: [{ scale: pulseAnim }] }]}>
          <Ionicons
            name={isVoice ? 'mic' : 'alarm'}
            size={56}
            color="#FFFFFF"
          />
        </Animated.View>

        <Text style={styles.timeText}>
          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>

        <Text style={styles.titleText}>{activeAlarm.title}</Text>

        {/* Spoken TTS Readout Trigger + Actionable Link */}
        <View style={styles.quickActionRow}>
          <TouchableOpacity
            style={styles.ttsBtn}
            onPress={() => speakReminderTTS(activeAlarm.title, user?.name || '')}
          >
            <Ionicons name="volume-high" size={18} color="#38BDF8" />
            <Text style={styles.ttsBtnText}>Speak Aloud (TTS)</Text>
          </TouchableOpacity>

          {activeAlarm.action_link ? (
            <TouchableOpacity
              style={styles.actionLinkBtn}
              onPress={() => Linking.openURL(activeAlarm.action_link)}
            >
              <Ionicons
                name={activeAlarm.action_link.startsWith('tel:') ? 'call' : 'open-outline'}
                size={18}
                color="#34D399"
              />
              <Text style={styles.actionLinkBtnText}>
                {activeAlarm.action_link.startsWith('tel:')
                  ? `Call Now (${activeAlarm.action_link.replace('tel:', '')})`
                  : 'Open Action Link'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.rawCard}>
          <Text style={styles.rawLabel}>
            {isVoice ? 'Original Voice Note Transcript / Note:' : 'Original Text Message:'}
          </Text>
          <Text style={styles.rawInputText}>"{activeAlarm.raw_input}"</Text>

          {activeAlarm.location_trigger ? (
            <View style={styles.metaLine}>
              <Ionicons name="location" size={14} color="#F472B6" />
              <Text style={styles.metaLineText}>
                Location Geofence: {activeAlarm.location_trigger}
              </Text>
            </View>
          ) : null}

          {activeAlarm.assigned_to_email ? (
            <View style={styles.metaLine}>
              <Ionicons name="people" size={14} color="#A5B4FC" />
              <Text style={styles.metaLineText}>
                Shared / Delegated with: {activeAlarm.assigned_to_email}
              </Text>
            </View>
          ) : null}

          {activeAlarm.audio_url ? (
            <TouchableOpacity style={styles.playVoiceBtn} onPress={handlePlayVoice}>
              <Ionicons
                name={playingVoice ? 'stop-circle' : 'play-circle'}
                size={24}
                color="#1E1B4B"
              />
              <Text style={styles.playVoiceText}>
                {playingVoice ? 'Stop Voice Note Playback' : 'Play Original Voice Note'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Sub-Checklist inside the Alarm Modal */}
        {subtasks.length > 0 && (
          <View style={styles.subtasksCard}>
            <Text style={styles.subtasksTitle}>TASK SUB-CHECKLIST</Text>
            {subtasks.map((st, idx) => (
              <TouchableOpacity
                key={idx}
                style={styles.subtaskRow}
                onPress={() => handleToggleSubtask(idx)}
              >
                <Ionicons
                  name={st.done ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={st.done ? '#34D399' : '#94A3B8'}
                />
                <Text
                  style={[
                    styles.subtaskText,
                    st.done && { textDecorationLine: 'line-through', color: '#64748B' }
                  ]}
                >
                  {st.text}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Wake-Up / Proof-of-Task Challenge for High Priority or Proof-enabled alarms */}
        {needsProof && (
          <View style={styles.challengeBox}>
            <View style={styles.challengeHeader}>
              <Ionicons name="shield-checkmark" size={16} color="#FBBF24" />
              <Text style={styles.challengeTitle}>
                WAKE-UP PROOF CHALLENGE (HIGH PRIORITY)
              </Text>
            </View>
            <Text style={styles.challengeSub}>
              Solve to confirm you are awake: What is {mathNums.a} + {mathNums.b}?
            </Text>
            <TextInput
              style={styles.challengeInput}
              placeholder={`Enter sum (${mathNums.a} + ${mathNums.b})`}
              placeholderTextColor="#64748B"
              keyboardType="numeric"
              value={challengeAnswer}
              onChangeText={(t) => {
                setChallengeAnswer(t);
                setChallengeError('');
              }}
            />
            {challengeError ? (
              <Text style={styles.challengeErrText}>{challengeError}</Text>
            ) : null}
          </View>
        )}

        {activeAlarm.snooze_count > 0 && (
          <Text style={styles.snoozeCountBadge}>
            Snoozed {activeAlarm.snooze_count} time(s) previously
          </Text>
        )}

        <View style={styles.snoozeSection}>
          <Text style={styles.sectionHeader}>SNOOZE ALARM FOR</Text>
          <View style={styles.snoozeRow}>
            {[1, 5, 10, 15].map((mins) => (
              <TouchableOpacity
                key={mins}
                style={styles.snoozeChip}
                onPress={() => handleReminderAction(activeAlarm.id, 'snooze', mins)}
              >
                <Ionicons name="time-outline" size={16} color="#E0E7FF" />
                <Text style={styles.snoozeChipText}>+{mins}m</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity
          style={styles.completeBtn}
          onPress={handleCompleteDismiss}
        >
          <Ionicons name="checkmark-done-circle" size={26} color="#064E3B" />
          <Text style={styles.completeBtnText}>
            {needsProof ? 'Verify Proof & Complete Task' : 'Mark Task Done & Dismiss'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#1E1B4B',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22
  },
  topBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    marginBottom: 18,
    gap: 8
  },
  topBadgeText: {
    color: '#FDE68A',
    fontWeight: '700',
    fontSize: 11,
    letterSpacing: 0.8
  },
  bellCircle: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14
  },
  timeText: {
    fontSize: 38,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 4
  },
  titleText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F8FAFC',
    textAlign: 'center',
    marginBottom: 14
  },
  quickActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
    justifyContent: 'center'
  },
  ttsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(56,189,248,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.4)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999
  },
  ttsBtnText: {
    color: '#7DD3FC',
    fontWeight: '700',
    fontSize: 13
  },
  actionLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(52,211,153,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.4)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999
  },
  actionLinkBtnText: {
    color: '#6EE7B7',
    fontWeight: '700',
    fontSize: 13
  },
  rawCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)'
  },
  rawLabel: {
    color: '#A5B4FC',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4
  },
  rawInputText: {
    color: '#E2E8F0',
    fontSize: 14,
    fontStyle: 'italic'
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8
  },
  metaLineText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600'
  },
  playVoiceBtn: {
    marginTop: 12,
    backgroundColor: '#FBBF24',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  playVoiceText: {
    color: '#1E1B4B',
    fontWeight: '700',
    fontSize: 14
  },
  subtasksCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: 'rgba(15,23,42,0.65)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)'
  },
  subtasksTitle: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 8
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6
  },
  subtaskText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600'
  },
  challengeBox: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.45)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16
  },
  challengeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4
  },
  challengeTitle: {
    color: '#FDE68A',
    fontSize: 11,
    fontWeight: '800'
  },
  challengeSub: {
    color: '#F8FAFC',
    fontSize: 13,
    marginBottom: 8
  },
  challengeInput: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: '#475569'
  },
  challengeErrText: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6
  },
  snoozeCountBadge: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12
  },
  snoozeSection: {
    width: '100%',
    maxWidth: 460,
    marginBottom: 18,
    alignItems: 'center'
  },
  sectionHeader: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8
  },
  snoozeRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    flexWrap: 'wrap'
  },
  snoozeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 6
  },
  snoozeChipText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14
  },
  completeBtn: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#34D399',
    paddingVertical: 15,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10
  },
  completeBtnText: {
    color: '#064E3B',
    fontSize: 16,
    fontWeight: '800'
  }
});
