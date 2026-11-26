import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  Linking
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { useAuth } from '../context/AuthContext';
import { useReminders } from '../context/ReminderContext';
import { playVoiceNoteUrl, stopVoiceNotePlayback } from '../utils/sound';

const QUICK_PRESETS = [
  'Take medicine 3 times a day at 9:00 AM, 2:00 PM and 8:00 PM',
  'Remind me to drink water every 3 hours',
  'Urgent: Join Zoom standup https://meet.google.com/new in 20 seconds',
  'Buy milk when I reach Supermarket in 1 minute'
];

const MULTI_TIME_PRESETS = [
  { key: 'none', label: 'Single Time', slots: [] },
  { key: '2x', label: '2x Daily (9 AM, 9 PM)', slots: ['09:00', '21:00'] },
  { key: '3x', label: '3x Daily (9 AM, 2 PM, 8 PM)', slots: ['09:00', '14:00', '20:00'] },
  { key: '4x', label: '4x Daily (8 AM, 12 PM, 4 PM, 8 PM)', slots: ['08:00', '12:00', '16:00', '20:00'] }
];

const REPEAT_OPTIONS = [
  { value: 'auto', label: 'AI Auto-Detect' },
  { value: 'none', label: 'One-Time Only' },
  { value: 'every_20_seconds', label: 'Every 20s (Test)' },
  { value: 'every_30_minutes', label: 'Every 30 Mins' },
  { value: 'every_1_hours', label: 'Every 1 Hour' },
  { value: 'every_3_hours', label: 'Every 3 Hours' },
  { value: 'daily', label: 'Every Day' },
  { value: 'weekly', label: 'Every Week' }
];

const CATEGORIES = [
  { key: 'all', label: 'All', icon: 'apps', color: '#818CF8' },
  { key: 'health', label: 'Health', icon: 'fitness', color: '#34D399' },
  { key: 'work', label: 'Work', icon: 'briefcase', color: '#38BDF8' },
  { key: 'finance', label: 'Finance', icon: 'card', color: '#FBBF24' },
  { key: 'personal', label: 'Personal', icon: 'heart', color: '#F472B6' },
  { key: 'general', label: 'General', icon: 'bookmark', color: '#94A3B8' }
];

function getCategoryMeta(catKey) {
  return CATEGORIES.find((c) => c.key === catKey) || CATEGORIES[5];
}

function formatRepeatRule(rule) {
  if (!rule || rule === 'none') return null;
  if (rule === 'daily') return 'REPEATS DAILY';
  if (rule === 'weekly') return 'REPEATS WEEKLY';
  if (rule === 'hourly' || rule === 'every_1_hours') return 'EVERY 1 HOUR';
  const m = rule.match(/^every_(\d+)_(seconds|minutes|hours|days|weeks)$/);
  if (m) {
    return `EVERY ${m[1]} ${m[2].toUpperCase()}`;
  }
  return rule.toUpperCase();
}

function openGoogleCalendarExport(reminder) {
  const start = new Date(reminder.scheduled_at);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
    reminder.title
  )}&details=${encodeURIComponent(reminder.raw_input)}&dates=${fmt(start)}/${fmt(end)}`;
  Linking.openURL(url);
}

export default function HomeScreen({ onNavigateTab }) {
  const { user } = useAuth();
  const {
    reminders,
    previewNaturalLanguage,
    createReminder,
    updateSubtasks,
    handleReminderAction,
    deleteReminder,
    triggerAlarmNow
  } = useReminders();

  const [inputMode, setInputMode] = useState('text'); // 'text' | 'voice'
  const [rawText, setRawText] = useState('');
  const [selectedRepeat, setSelectedRepeat] = useState('auto');
  const [multiTimeSlots, setMultiTimeSlots] = useState([]);
  const [customSlotInput, setCustomSlotInput] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('auto');
  const [activeCategoryFilter, setActiveCategoryFilter] = useState('all');

  // Advanced Smart Options drawer
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [actionLink, setActionLink] = useState('');
  const [locationTrigger, setLocationTrigger] = useState('');
  const [assignedToEmail, setAssignedToEmail] = useState('');
  const [subtasksText, setSubtasksText] = useState('');
  const [requireProof, setRequireProof] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);

  const [aiPreview, setAiPreview] = useState(null);
  const [creating, setCreating] = useState(false);
  const [bannerError, setBannerError] = useState('');
  const [bannerSuccess, setBannerSuccess] = useState('');

  // Voice Note Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribingOnly, setIsTranscribingOnly] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedAudioBase64, setRecordedAudioBase64] = useState(null);
  const [recordedAudioExt, setRecordedAudioExt] = useState('.webm');
  const [recordedFileUri, setRecordedFileUri] = useState(null);
  const [playingId, setPlayingId] = useState(null);

  const recordingTimerRef = useRef(null);
  const nativeRecordingRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const pendingAudioPromiseRef = useRef(null);
  const speechRecRef = useRef(null);
  const latestTranscriptRef = useRef('');

  useEffect(() => {
    const trimmed = rawText.trim();
    if (!trimmed) {
      setAiPreview(null);
      return;
    }
    const timeout = setTimeout(async () => {
      const parsed = await previewNaturalLanguage(trimmed);
      setAiPreview(parsed);
    }, 260);
    return () => clearTimeout(timeout);
  }, [rawText]);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      stopVoiceNotePlayback();
    };
  }, []);

  async function startVoiceRecording() {
    setBannerError('');
    setBannerSuccess('');
    setRecordedAudioBase64(null);
    setRecordedFileUri(null);
    setRecordingSeconds(0);
    audioChunksRef.current = [];
    pendingAudioPromiseRef.current = null;
    latestTranscriptRef.current = '';
    setRawText('');

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // 1. Acquire physical microphone stream FIRST
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setBannerError('Microphone access requires HTTPS or localhost.');
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        mediaStreamRef.current = stream;

        let mimeType = '';
        let ext = '.webm';
        if (typeof window.MediaRecorder !== 'undefined') {
          if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            mimeType = 'audio/webm;codecs=opus';
            ext = '.webm';
          } else if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported('audio/mp4')) {
            mimeType = 'audio/mp4';
            ext = '.m4a';
          } else if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported('audio/webm')) {
            mimeType = 'audio/webm';
            ext = '.webm';
          }
        }
        setRecordedAudioExt(ext);

        const recorder = mimeType
          ? new window.MediaRecorder(stream, { mimeType })
          : new window.MediaRecorder(stream);

        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) {
            audioChunksRef.current.push(ev.data);
          }
        };

        // Start recording with 250ms timeslice so chunks are captured continuously
        recorder.start(250);
        mediaRecorderRef.current = recorder;
        setIsRecording(true);

        recordingTimerRef.current = setInterval(() => {
          setRecordingSeconds((s) => s + 1);
        }, 1000);
      } catch (err) {
        setBannerError(
          `Microphone permission denied or unavailable (${err.message || 'Check browser mic settings'}).`
        );
        return;
      }

      // 2. Start SpeechRecognition 150ms AFTER MediaRecorder has acquired the stream so live AI transcription works on both mobile & desktop
      setTimeout(() => {
        try {
          const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
          if (SpeechRecognition) {
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';
            recognition.onresult = (event) => {
              let transcript = '';
              for (let i = 0; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript + ' ';
              }
              const cleaned = transcript.trim();
              if (cleaned) {
                latestTranscriptRef.current = cleaned;
                setRawText(cleaned);
              }
            };
            recognition.onerror = () => {
              // Ignore if mobile OS limits simultaneous speech recognition while MediaRecorder is open
            };
            recognition.start();
            speechRecRef.current = recognition;
          }
        } catch (e) {}
      }, 150);
      return;
    } else {
      try {
        const perm = await Audio.requestPermissionsAsync();
        if (perm.status === 'granted') {
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true
          });
          const { recording } = await Audio.Recording.createAsync(
            Audio.RecordingOptionsPresets.HIGH_QUALITY
          );
          nativeRecordingRef.current = recording;
          setIsRecording(true);
          recordingTimerRef.current = setInterval(() => {
            setRecordingSeconds((s) => s + 1);
          }, 1000);
          return;
        } else {
          setBannerError('Microphone permission was not granted.');
        }
      } catch (err) {
        setBannerError('Could not start native audio recorder.');
      }
    }
  }

  async function stopVoiceRecording() {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);

    if (speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch (e) {}
      speechRecRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      const recorder = mediaRecorderRef.current;
      mediaRecorderRef.current = null;

      const audioPromise = new Promise((resolve) => {
        recorder.onstop = () => {
          try {
            const blobType = recorder.mimeType || (recordedAudioExt === '.m4a' ? 'audio/mp4' : 'audio/webm');
            const blob = new Blob(audioChunksRef.current, { type: blobType });
            if (mediaStreamRef.current) {
              mediaStreamRef.current.getTracks().forEach((t) => t.stop());
              mediaStreamRef.current = null;
            }
            if (blob.size === 0) {
              const fallback = generateSampleWavDataUri();
              setRecordedAudioBase64(fallback);
              setRecordedAudioExt('.wav');
              resolve(fallback);
              return;
            }
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64Data = reader.result;
              setRecordedAudioBase64(base64Data);
              resolve(base64Data);
            };
            reader.onerror = () => {
              const fallback = generateSampleWavDataUri();
              setRecordedAudioBase64(fallback);
              resolve(fallback);
            };
            reader.readAsDataURL(blob);
          } catch (e) {
            const fallback = generateSampleWavDataUri();
            setRecordedAudioBase64(fallback);
            resolve(fallback);
          }
        };
      });

      pendingAudioPromiseRef.current = audioPromise;
      try {
        recorder.stop();
      } catch (e) {
        pendingAudioPromiseRef.current = null;
      }

      const finalBase64 = await audioPromise;
      // Immediately send the recorded voice note audio to Gemini 2.5 Flash AI for multimodal voice transcription & extraction!
      if (finalBase64) {
        try {
          const mime = recordedAudioExt === '.m4a' ? 'audio/mp4' : 'audio/webm';
          const geminiParsed = await previewNaturalLanguage(
            latestTranscriptRef.current || rawText || '',
            finalBase64,
            mime
          );
          if (geminiParsed) {
            setAiPreview(geminiParsed);
            if (geminiParsed.transcript && !rawText.trim()) {
              latestTranscriptRef.current = geminiParsed.transcript;
              setRawText(geminiParsed.transcript);
            }
          }
        } catch (e) {}
      }
      return;
    }

    if (nativeRecordingRef.current) {
      try {
        await nativeRecordingRef.current.stopAndUnloadAsync();
        const uri = nativeRecordingRef.current.getURI();
        setRecordedFileUri(uri);
      } catch (e) {}
      nativeRecordingRef.current = null;
    }
  }

  function startDedicatedSpeechToText() {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setBannerError('Tip: Tap the microphone icon on your phone keyboard to dictate into the transcript box.');
      return;
    }

    if (isTranscribingOnly && speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch (e) {}
      setIsTranscribingOnly(false);
      return;
    }

    try {
      setBannerError('');
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      setIsTranscribingOnly(true);

      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript + ' ';
        }
        const cleaned = transcript.trim();
        if (cleaned) {
          latestTranscriptRef.current = cleaned;
          setRawText(cleaned);
        }
      };
      recognition.onend = () => {
        setIsTranscribingOnly(false);
      };
      recognition.onerror = () => {
        setIsTranscribingOnly(false);
      };
      recognition.start();
      speechRecRef.current = recognition;
    } catch (e) {
      setIsTranscribingOnly(false);
    }
  }

  async function handleSaveReminder() {
    setBannerError('');
    setBannerSuccess('');

    // If user is still recording when they tap Save, stop and finalize the recording first
    let latestBase64 = recordedAudioBase64;
    if (isRecording) {
      await stopVoiceRecording();
    }
    if (pendingAudioPromiseRef.current) {
      latestBase64 = await pendingAudioPromiseRef.current;
    }

    const textToParse = (rawText.trim() || latestTranscriptRef.current.trim());
    const hasRecordedVoice = inputMode === 'voice' && !!(latestBase64 || recordedAudioBase64 || recordedFileUri);

    if (!textToParse && !hasRecordedVoice) {
      setBannerError(
        inputMode === 'voice'
          ? 'Please record a voice note or speak/type your task in the transcript box below!'
          : 'Please enter a reminder message.'
      );
      return;
    }

    const parsedSubtasks = subtasksText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((text) => ({ text, done: false }));

    setCreating(true);
    try {
      const isVoice = inputMode === 'voice';
      const audioBase64ToUse =
        isVoice && !recordedFileUri
          ? latestBase64 || recordedAudioBase64 || generateSampleWavDataUri()
          : null;

      const result = await createReminder({
        rawInput: textToParse,
        multiTimes: multiTimeSlots.length > 0 ? multiTimeSlots : undefined,
        repeatRule: selectedRepeat === 'auto' ? undefined : selectedRepeat,
        category: selectedCategory === 'auto' ? undefined : selectedCategory,
        actionLink: actionLink.trim() || undefined,
        locationTrigger: locationTrigger.trim() || undefined,
        assignedToEmail: assignedToEmail.trim() || undefined,
        requireProof: requireProof ? true : undefined,
        ttsEnabled,
        subtasks: parsedSubtasks,
        inputType: isVoice ? 'voice' : 'text',
        audioBase64: audioBase64ToUse,
        audioExt: latestBase64 || recordedAudioBase64 ? recordedAudioExt : '.wav',
        audioDuration: recordingSeconds || 4,
        audioFileUri: recordedFileUri
      });

      setRawText('');
      setSelectedRepeat('auto');
      setMultiTimeSlots([]);
      setCustomSlotInput('');
      setSelectedCategory('auto');
      setActionLink('');
      setLocationTrigger('');
      setAssignedToEmail('');
      setSubtasksText('');
      setRequireProof(false);
      setAiPreview(null);
      setRecordedAudioBase64(null);
      setRecordedFileUri(null);
      setRecordingSeconds(0);
      setBannerSuccess(
        result.count > 1
          ? `Scheduled "${result.reminder.title}" across ${result.count} daily time slots!`
          : `Scheduled "${result.reminder.title}" for ${new Date(
              result.reminder.scheduled_at
            ).toLocaleTimeString()}${result.quietHoursAdjusted ? ' (Adjusted for Quiet Hours)' : ''}`
      );
    } catch (err) {
      setBannerError(err.message || 'Could not create reminder.');
    } finally {
      setCreating(false);
    }
  }

  async function handleTogglePlay(reminder) {
    if (playingId === reminder.id) {
      await stopVoiceNotePlayback();
      setPlayingId(null);
      return;
    }
    setPlayingId(reminder.id);
    await playVoiceNoteUrl(reminder.audio_url, () => {
      setPlayingId(null);
    });
  }

  async function handleToggleCardSubtask(reminder, index) {
    let list = [];
    try {
      list = JSON.parse(reminder.subtasks_json || '[]');
    } catch (e) {}
    const updated = list.map((item, i) =>
      i === index ? { ...item, done: !item.done } : item
    );
    await updateSubtasks(reminder.id, updated);
  }

  const filteredReminders = reminders.filter((r) =>
    activeCategoryFilter === 'all' ? true : (r.category || 'general') === activeCategoryFilter
  );

  const upcomingReminders = filteredReminders.filter(
    (r) => r.status === 'pending' || r.status === 'snoozed'
  );
  const completedOrMissed = filteredReminders.filter(
    (r) => r.status === 'completed' || r.status === 'missed'
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* SaaS Usage + Streak Banner */}
      <View style={styles.quotaBar}>
        <View style={styles.quotaLeft}>
          <View
            style={[
              styles.planBadge,
              user?.plan !== 'free' ? styles.planPro : styles.planFree
            ]}
          >
            <Text style={styles.planBadgeText}>
              {(user?.plan || 'free').toUpperCase()} SAAS
            </Text>
          </View>
          <Text style={styles.quotaText}>
            {user?.plan !== 'free'
              ? 'Unlimited Voice & Text AI Active'
              : `Voice Notes: ${user?.voice_quota_used || 0}/${
                  user?.voice_quota_limit || 5
                }`}
          </Text>
          <View style={styles.streakPill}>
            <Ionicons name="flame" size={14} color="#F59E0B" />
            <Text style={styles.streakText}>{user?.streak_days || 1}d Streak</Text>
          </View>
        </View>
        {user?.plan === 'free' && (
          <TouchableOpacity
            style={styles.upgradeLink}
            onPress={() => onNavigateTab('subscription')}
          >
            <Text style={styles.upgradeLinkText}>Upgrade</Text>
            <Ionicons name="arrow-up-right-box-outline" size={14} color="#A5B4FC" />
          </TouchableOpacity>
        )}
      </View>

      {/* Input Composer Card (Text or Voice Note) */}
      <View style={styles.composerCard}>
        <View style={styles.modeTabs}>
          <TouchableOpacity
            style={[
              styles.modeTab,
              inputMode === 'text' && styles.modeTabActive
            ]}
            onPress={() => setInputMode('text')}
          >
            <Ionicons
              name="chatbubble-ellipses"
              size={18}
              color={inputMode === 'text' ? '#FFFFFF' : '#94A3B8'}
            />
            <Text
              style={[
                styles.modeTabText,
                inputMode === 'text' && styles.modeTabTextActive
              ]}
            >
              Text Message Input
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.modeTab,
              inputMode === 'voice' && styles.modeTabVoiceActive
            ]}
            onPress={() => setInputMode('voice')}
          >
            <Ionicons
              name="mic"
              size={18}
              color={inputMode === 'voice' ? '#FFFFFF' : '#94A3B8'}
            />
            <Text
              style={[
                styles.modeTabText,
                inputMode === 'voice' && styles.modeTabTextActive
              ]}
            >
              Voice Note Input
            </Text>
          </TouchableOpacity>
        </View>

        {inputMode === 'voice' && (
          <View style={styles.voiceRecorderBox}>
            <TouchableOpacity
              style={[
                styles.recordCircleBtn,
                isRecording && styles.recordCircleBtnActive
              ]}
              onPress={isRecording ? stopVoiceRecording : startVoiceRecording}
            >
              <Ionicons
                name={isRecording ? 'stop' : 'mic'}
                size={34}
                color="#FFFFFF"
              />
            </TouchableOpacity>
            <Text style={styles.voiceInstruction}>
              {isRecording
                ? `🔴 Recording Voice Note... (${recordingSeconds}s) — Tap to Stop`
                : recordedAudioBase64 || recordedFileUri
                ? `Voice Note Captured (${recordingSeconds || 4}s) ✓`
                : 'Tap Microphone to Record Voice Note'}
            </Text>
            <Text style={styles.voiceSubHint}>
              {recordedAudioBase64 || recordedFileUri
                ? 'Tap Preview below to listen to your recording before saving'
                : 'Speak your reminder clearly into your phone microphone'}
            </Text>
            {(recordedAudioBase64 || recordedFileUri) && !isRecording && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 10 }}>
                <TouchableOpacity
                  style={styles.previewVoiceBtn}
                  onPress={() =>
                    playVoiceNoteUrl(recordedAudioBase64 || recordedFileUri)
                  }
                >
                  <Ionicons name="play-circle" size={18} color="#F472B6" />
                  <Text style={styles.previewVoiceBtnText}>
                    Preview Audio
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.previewVoiceBtn,
                    {
                      backgroundColor: isTranscribingOnly
                        ? 'rgba(239,68,68,0.2)'
                        : 'rgba(99,102,241,0.18)',
                      borderColor: isTranscribingOnly ? '#EF4444' : '#818CF8'
                    }
                  ]}
                  onPress={startDedicatedSpeechToText}
                >
                  <Ionicons
                    name={isTranscribingOnly ? 'radio' : 'sparkles'}
                    size={16}
                    color={isTranscribingOnly ? '#FCA5A5' : '#A5B4FC'}
                  />
                  <Text
                    style={[
                      styles.previewVoiceBtnText,
                      { color: isTranscribingOnly ? '#FCA5A5' : '#A5B4FC' }
                    ]}
                  >
                    {isTranscribingOnly
                      ? 'Listening... Speak Now'
                      : 'AI Voice-to-Text Dictate'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        <TextInput
          style={styles.textInput}
          multiline
          placeholder={
            inputMode === 'voice'
              ? 'Voice transcript / note (e.g., "Remind me to drink water every 3 hours")...'
              : 'Type a message (e.g., "Remind me to drink water every 3 hours" or "Call client +18005550199 in 30 seconds")...'
          }
          placeholderTextColor="#64748B"
          value={rawText}
          onChangeText={setRawText}
        />

        {/* Quick-fill NLP chips */}
        <View style={styles.presetsSection}>
          <Text style={styles.presetsLabel}>Try Instant AI Examples:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.presetsRow}>
              {QUICK_PRESETS.map((preset, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.presetChip}
                  onPress={() => setRawText(preset)}
                >
                  <Ionicons name="flash" size={12} color="#818CF8" />
                  <Text style={styles.presetChipText}>{preset}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* Repeat / Interval Scheduler Selector */}
        <View style={styles.presetsSection}>
          <Text style={styles.presetsLabel}>
            Repeat Interval Scheduler (or type "every 3 hours" in your message):
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.presetsRow}>
              {REPEAT_OPTIONS.map((opt) => {
                const active = selectedRepeat === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.presetChip,
                      active && styles.repeatChipActive
                    ]}
                    onPress={() => setSelectedRepeat(opt.value)}
                  >
                    <Ionicons
                      name="repeat"
                      size={13}
                      color={active ? '#FFFFFF' : '#38BDF8'}
                    />
                    <Text
                      style={[
                        styles.presetChipText,
                        active && { color: '#FFFFFF', fontWeight: '700' }
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </View>

        {/* Multi-Time Daily Activity Scheduler (Same activity at multiple specific times) */}
        <View style={styles.presetsSection}>
          <Text style={styles.presetsLabel}>
            Multi-Time Daily Scheduler (Do the same activity multiple times a day):
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.presetsRow}>
              {MULTI_TIME_PRESETS.map((mp) => {
                const isSelected =
                  mp.slots.length === multiTimeSlots.length &&
                  mp.slots.every((s, i) => multiTimeSlots[i] === s);
                return (
                  <TouchableOpacity
                    key={mp.key}
                    style={[
                      styles.presetChip,
                      isSelected && styles.repeatChipActive
                    ]}
                    onPress={() => setMultiTimeSlots([...mp.slots])}
                  >
                    <Ionicons
                      name="time"
                      size={13}
                      color={isSelected ? '#FFFFFF' : '#F472B6'}
                    />
                    <Text
                      style={[
                        styles.presetChipText,
                        isSelected && { color: '#FFFFFF', fontWeight: '700' }
                      ]}
                    >
                      {mp.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          {/* Custom Time Slot Builder */}
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            <TextInput
              style={[styles.advInput, { width: 135, paddingVertical: 6 }]}
              placeholder="Add time (e.g. 07:30)"
              placeholderTextColor="#64748B"
              value={customSlotInput}
              onChangeText={setCustomSlotInput}
            />
            <TouchableOpacity
              style={[styles.presetChip, { backgroundColor: '#312E81', borderColor: '#6366F1' }]}
              onPress={() => {
                const cleaned = customSlotInput.trim().replace('.', ':');
                if (/^\d{1,2}:\d{2}(\s*(am|pm))?$/i.test(cleaned)) {
                  if (!multiTimeSlots.includes(cleaned)) {
                    setMultiTimeSlots([...multiTimeSlots, cleaned]);
                  }
                  setCustomSlotInput('');
                } else {
                  setBannerError('Enter time as HH:MM (e.g. 07:30 or 14:30)');
                }
              }}
            >
              <Ionicons name="add-circle" size={14} color="#A5B4FC" />
              <Text style={[styles.presetChipText, { color: '#FFFFFF', fontWeight: '700' }]}>
                + Add Time Slot
              </Text>
            </TouchableOpacity>

            {multiTimeSlots.map((slot, idx) => (
              <TouchableOpacity
                key={idx}
                style={[styles.presetChip, { backgroundColor: 'rgba(244,114,182,0.18)', borderColor: '#F472B6' }]}
                onPress={() =>
                  setMultiTimeSlots(multiTimeSlots.filter((_, i) => i !== idx))
                }
              >
                <Ionicons name="alarm" size={12} color="#F472B6" />
                <Text style={[styles.presetChipText, { color: '#F472B6', fontWeight: '700' }]}>
                  {slot} ✕
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Advanced Smart Options Toggle */}
        <TouchableOpacity
          style={styles.advancedToggleBtn}
          onPress={() => setShowAdvanced(!showAdvanced)}
        >
          <Ionicons
            name={showAdvanced ? 'chevron-up-circle' : 'options-outline'}
            size={17}
            color="#A5B4FC"
          />
          <Text style={styles.advancedToggleText}>
            {showAdvanced
              ? 'Hide Smart Options (Sub-checklist, Location, Delegate, TTS, Wake-Up Proof)'
              : 'Add Smart Options (Sub-checklist, Call/Zoom Link, Location, Delegate, Wake-Up Proof)'}
          </Text>
        </TouchableOpacity>

        {showAdvanced && (
          <View style={styles.advancedPanel}>
            <View style={styles.advRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.advLabel}>Sub-Checklist (comma separated)</Text>
                <TextInput
                  style={styles.advInput}
                  placeholder="e.g. Fill bottle, Log 250ml, Stretch"
                  placeholderTextColor="#64748B"
                  value={subtasksText}
                  onChangeText={setSubtasksText}
                />
              </View>
            </View>

            <View style={styles.advRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.advLabel}>Action Link (tel: or https://)</Text>
                <TextInput
                  style={styles.advInput}
                  placeholder="e.g. tel:+18005550199 or https://meet.google.com"
                  placeholderTextColor="#64748B"
                  value={actionLink}
                  onChangeText={setActionLink}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.advLabel}>Location Trigger (Geofence)</Text>
                <TextInput
                  style={styles.advInput}
                  placeholder="e.g. Supermarket, Office, Gym"
                  placeholderTextColor="#64748B"
                  value={locationTrigger}
                  onChangeText={setLocationTrigger}
                />
              </View>
            </View>

            <View style={styles.advRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.advLabel}>Delegate / Share with Team Email</Text>
                <TextInput
                  style={styles.advInput}
                  placeholder="e.g. teammate@company.com"
                  placeholderTextColor="#64748B"
                  autoCapitalize="none"
                  value={assignedToEmail}
                  onChangeText={setAssignedToEmail}
                />
              </View>
            </View>

            <View style={styles.advTogglesRow}>
              <TouchableOpacity
                style={[styles.toggleChip, ttsEnabled && styles.toggleChipOn]}
                onPress={() => setTtsEnabled(!ttsEnabled)}
              >
                <Ionicons
                  name="volume-high"
                  size={15}
                  color={ttsEnabled ? '#FFFFFF' : '#94A3B8'}
                />
                <Text style={[styles.toggleChipText, ttsEnabled && { color: '#FFFFFF' }]}>
                  Spoken TTS Readout: {ttsEnabled ? 'ON' : 'OFF'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.toggleChip, requireProof && styles.toggleChipWarn]}
                onPress={() => setRequireProof(!requireProof)}
              >
                <Ionicons
                  name="shield-checkmark"
                  size={15}
                  color={requireProof ? '#1E1B4B' : '#94A3B8'}
                />
                <Text
                  style={[
                    styles.toggleChipText,
                    requireProof && { color: '#1E1B4B', fontWeight: '800' }
                  ]}
                >
                  Wake-Up Math Proof: {requireProof ? 'REQUIRED' : 'OFF'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Live AI Extraction Preview */}
        {aiPreview && (
          <View style={styles.aiPreviewBox}>
            <View style={styles.aiPreviewHeader}>
              <Ionicons name="sparkles" size={15} color="#A5B4FC" />
              <Text style={styles.aiPreviewHeaderText}>
                {aiPreview.aiEngine && aiPreview.aiEngine.startsWith('gemini')
                  ? `GOOGLE GEMINI 2.5 FLASH AI EXTRACTION`
                  : `AI NATURAL LANGUAGE & ENTITY EXTRACTION`}
              </Text>
            </View>
            <View style={styles.aiPreviewGrid}>
              <View style={styles.aiPreviewItem}>
                <Text style={styles.aiFieldLabel}>Task to Remind:</Text>
                <Text style={styles.aiFieldValue}>{aiPreview.title}</Text>
              </View>
              <View style={styles.aiPreviewItem}>
                <Text style={styles.aiFieldLabel}>Alarm Trigger Time:</Text>
                <Text style={styles.aiFieldValue}>
                  {new Date(aiPreview.scheduledAt).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}{' '}
                  ({aiPreview.parsedTimeText})
                </Text>
              </View>
              <View style={styles.aiMetaRow}>
                <View style={styles.metaTag}>
                  <Text style={styles.metaTagText}>
                    Category: {(aiPreview.category || 'general').toUpperCase()}
                  </Text>
                </View>
                <View style={styles.metaTag}>
                  <Text style={styles.metaTagText}>
                    Priority: {aiPreview.priority.toUpperCase()}
                  </Text>
                </View>
                {(selectedRepeat !== 'auto'
                  ? selectedRepeat !== 'none'
                  : aiPreview.repeatRule !== 'none') && (
                  <View style={[styles.metaTag, { backgroundColor: 'rgba(56,189,248,0.2)' }]}>
                    <Text style={[styles.metaTagText, { color: '#7DD3FC' }]}>
                      ↻{' '}
                      {selectedRepeat !== 'auto'
                        ? formatRepeatRule(selectedRepeat)
                        : aiPreview.repeatLabel || formatRepeatRule(aiPreview.repeatRule)}
                    </Text>
                  </View>
                )}
                {(multiTimeSlots.length > 0 || (aiPreview.multiTimes && aiPreview.multiTimes.length > 1)) && (
                  <View style={[styles.metaTag, { backgroundColor: 'rgba(244,114,182,0.22)' }]}>
                    <Text style={[styles.metaTagText, { color: '#F472B6' }]}>
                      ⏰ Multi-Times:{' '}
                      {(multiTimeSlots.length > 0 ? multiTimeSlots : aiPreview.multiTimes).join(', ')}
                    </Text>
                  </View>
                )}
                {(actionLink || aiPreview.actionLink) && (
                  <View style={[styles.metaTag, { backgroundColor: 'rgba(52,211,153,0.2)' }]}>
                    <Text style={[styles.metaTagText, { color: '#6EE7B7' }]}>
                      Action: {actionLink || aiPreview.actionLink}
                    </Text>
                  </View>
                )}
                {(locationTrigger || aiPreview.locationTrigger) && (
                  <View style={[styles.metaTag, { backgroundColor: 'rgba(244,114,182,0.2)' }]}>
                    <Text style={[styles.metaTagText, { color: '#F472B6' }]}>
                      📍 {locationTrigger || aiPreview.locationTrigger}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        )}

        {bannerError ? (
          <View style={styles.errorBanner}>
            <Ionicons name="warning" size={16} color="#FCA5A5" />
            <Text style={styles.errorBannerText}>{bannerError}</Text>
          </View>
        ) : null}

        {bannerSuccess ? (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle" size={16} color="#6EE7B7" />
            <Text style={styles.successBannerText}>{bannerSuccess}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[
            styles.submitBtn,
            inputMode === 'voice' && styles.submitBtnVoice
          ]}
          onPress={handleSaveReminder}
          disabled={creating}
        >
          {creating ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Ionicons
                name={inputMode === 'voice' ? 'mic-circle' : 'alarm'}
                size={22}
                color="#FFFFFF"
              />
              <Text style={styles.submitBtnText}>
                {inputMode === 'voice'
                  ? 'Save Voice Note & Set Smart Alarm'
                  : 'Set Smart Reminder Alarm'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Category Filter Bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginBottom: 14 }}
      >
        <View style={styles.presetsRow}>
          {CATEGORIES.map((cat) => {
            const active = activeCategoryFilter === cat.key;
            return (
              <TouchableOpacity
                key={cat.key}
                style={[
                  styles.categoryFilterChip,
                  active && { backgroundColor: '#4F46E5', borderColor: '#818CF8' }
                ]}
                onPress={() => setActiveCategoryFilter(cat.key)}
              >
                <Ionicons
                  name={cat.icon}
                  size={14}
                  color={active ? '#FFFFFF' : cat.color}
                />
                <Text
                  style={[
                    styles.categoryFilterText,
                    active && { color: '#FFFFFF', fontWeight: '700' }
                  ]}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Active / Upcoming Alarms List */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>
          Active & Upcoming Alarms ({upcomingReminders.length})
        </Text>
      </View>

      {upcomingReminders.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="alarm-outline" size={38} color="#475569" />
          <Text style={styles.emptyTitle}>No active alarms in this category</Text>
          <Text style={styles.emptySub}>
            Type a text message or record a voice note above to schedule a task alarm.
          </Text>
        </View>
      ) : (
        upcomingReminders.map((rem) => {
          const catMeta = getCategoryMeta(rem.category || 'general');
          let subtasks = [];
          try {
            subtasks = JSON.parse(rem.subtasks_json || '[]');
          } catch (e) {}

          return (
            <View key={rem.id} style={styles.reminderCard}>
              <View style={styles.reminderTop}>
                <View style={styles.reminderTypeBadge}>
                  <Ionicons
                    name={rem.input_type === 'voice' ? 'mic' : 'chatbubble-ellipses'}
                    size={14}
                    color={rem.input_type === 'voice' ? '#F472B6' : '#818CF8'}
                  />
                  <Text
                    style={[
                      styles.reminderTypeText,
                      { color: rem.input_type === 'voice' ? '#F472B6' : '#818CF8' }
                    ]}
                  >
                    {rem.input_type === 'voice' ? 'VOICE NOTE' : 'TEXT'}
                  </Text>

                  <View style={[styles.catBadge, { borderColor: catMeta.color }]}>
                    <Ionicons name={catMeta.icon} size={11} color={catMeta.color} />
                    <Text style={[styles.catBadgeText, { color: catMeta.color }]}>
                      {catMeta.label.toUpperCase()}
                    </Text>
                  </View>

                  {rem.require_proof ? (
                    <View style={styles.proofBadge}>
                      <Ionicons name="shield-checkmark" size={11} color="#FBBF24" />
                      <Text style={styles.proofBadgeText}>PROOF</Text>
                    </View>
                  ) : null}
                </View>

                <View
                  style={[
                    styles.statusBadge,
                    rem.status === 'snoozed' && styles.statusSnoozed
                  ]}
                >
                  <Text style={styles.statusBadgeText}>
                    {rem.status.toUpperCase()}
                    {rem.snooze_count > 0 ? ` (${rem.snooze_count}x)` : ''}
                  </Text>
                </View>
              </View>

              <Text style={styles.reminderTitle}>{rem.title}</Text>
              <Text style={styles.reminderRaw}>"{rem.raw_input}"</Text>

              <View style={styles.scheduleRow}>
                <Ionicons name="time-outline" size={16} color="#FBBF24" />
                <Text style={styles.scheduleTimeText}>
                  Alarm:{' '}
                  {new Date(rem.scheduled_at).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}
                </Text>
                {rem.repeat_rule && rem.repeat_rule !== 'none' && (
                  <View style={styles.repeatBadge}>
                    <Ionicons name="repeat" size={13} color="#38BDF8" />
                    <Text style={styles.repeatBadgeText}>
                      {formatRepeatRule(rem.repeat_rule)}
                    </Text>
                  </View>
                )}
                {rem.location_trigger ? (
                  <View style={styles.locBadge}>
                    <Ionicons name="location" size={12} color="#F472B6" />
                    <Text style={styles.locBadgeText}>{rem.location_trigger}</Text>
                  </View>
                ) : null}
                {rem.assigned_to_email ? (
                  <View style={styles.delegateBadge}>
                    <Ionicons name="people" size={12} color="#A5B4FC" />
                    <Text style={styles.delegateBadgeText}>{rem.assigned_to_email}</Text>
                  </View>
                ) : null}
              </View>

              {/* Inline Sub-Checklist */}
              {subtasks.length > 0 && (
                <View style={styles.inlineSubtasks}>
                  {subtasks.map((st, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={styles.inlineSubtaskRow}
                      onPress={() => handleToggleCardSubtask(rem, idx)}
                    >
                      <Ionicons
                        name={st.done ? 'checkbox' : 'square-outline'}
                        size={17}
                        color={st.done ? '#34D399' : '#94A3B8'}
                      />
                      <Text
                        style={[
                          styles.inlineSubtaskText,
                          st.done && { textDecorationLine: 'line-through', color: '#64748B' }
                        ]}
                      >
                        {st.text}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={styles.actionsBar}>
                {rem.audio_url && (
                  <TouchableOpacity
                    style={styles.voicePlayChip}
                    onPress={() => handleTogglePlay(rem)}
                  >
                    <Ionicons
                      name={playingId === rem.id ? 'stop-circle' : 'play-circle'}
                      size={17}
                      color="#F472B6"
                    />
                    <Text style={styles.voicePlayChipText}>
                      {playingId === rem.id ? 'Stop' : 'Voice Note'}
                    </Text>
                  </TouchableOpacity>
                )}

                {rem.action_link ? (
                  <TouchableOpacity
                    style={styles.doneChip}
                    onPress={() => Linking.openURL(rem.action_link)}
                  >
                    <Ionicons
                      name={rem.action_link.startsWith('tel:') ? 'call' : 'open-outline'}
                      size={16}
                      color="#34D399"
                    />
                    <Text style={styles.doneChipText}>
                      {rem.action_link.startsWith('tel:') ? 'Call' : 'Open Link'}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={styles.gcalChip}
                  onPress={() => openGoogleCalendarExport(rem)}
                >
                  <Ionicons name="calendar-outline" size={16} color="#7DD3FC" />
                  <Text style={styles.gcalChipText}>+Calendar</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.testRingChip}
                  onPress={() => triggerAlarmNow(rem)}
                >
                  <Ionicons name="notifications-circle" size={17} color="#FBBF24" />
                  <Text style={styles.testRingText}>Ring Now</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.doneChip}
                  onPress={() => handleReminderAction(rem.id, 'complete')}
                >
                  <Ionicons name="checkmark-circle" size={17} color="#34D399" />
                  <Text style={styles.doneChipText}>Done</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.deleteIconBtn}
                  onPress={() => deleteReminder(rem.id)}
                >
                  <Ionicons name="trash-outline" size={18} color="#94A3B8" />
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}

      {/* Recently Completed / Missed */}
      {completedOrMissed.length > 0 && (
        <>
          <View style={[styles.sectionHeaderRow, { marginTop: 22 }]}>
            <Text style={styles.sectionTitle}>
              Recently Completed / Missed ({completedOrMissed.length})
            </Text>
          </View>
          {completedOrMissed.slice(0, 5).map((rem) => (
            <View key={rem.id} style={[styles.reminderCard, styles.reminderCardDim]}>
              <View style={styles.reminderTop}>
                <Text style={styles.completedTitle}>{rem.title}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text
                    style={[
                      styles.completedBadge,
                      rem.status === 'missed' && { color: '#F87171' }
                    ]}
                  >
                    {rem.status.toUpperCase()}
                  </Text>
                  {rem.status === 'missed' && (
                    <TouchableOpacity
                      style={styles.testRingChip}
                      onPress={() => triggerAlarmNow(rem)}
                    >
                      <Ionicons name="notifications" size={14} color="#FBBF24" />
                      <Text style={styles.testRingText}>Ring Again</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              <Text style={styles.reminderRaw}>"{rem.raw_input}"</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function generateSampleWavDataUri() {
  const sampleRate = 8000;
  const numSamples = 6000;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const freq = i < numSamples / 2 ? 523.25 : 659.25;
    const sample = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 2) * 0.35;
    view.setInt16(44 + i * 2, sample * 32767, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = typeof btoa !== 'undefined' ? btoa(binary) : '';
  return `data:audio/wav;base64,${base64}`;
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
  quotaBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155'
  },
  quotaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap'
  },
  planBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6
  },
  planFree: {
    backgroundColor: '#334155'
  },
  planPro: {
    backgroundColor: '#4F46E5'
  },
  planBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800'
  },
  quotaText: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '600'
  },
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(245,158,11,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999
  },
  streakText: {
    color: '#FBBF24',
    fontSize: 12,
    fontWeight: '800'
  },
  upgradeLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  upgradeLinkText: {
    color: '#A5B4FC',
    fontSize: 13,
    fontWeight: '700'
  },
  composerCard: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 18
  },
  modeTabs: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16
  },
  modeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 9
  },
  modeTabActive: {
    backgroundColor: '#4F46E5'
  },
  modeTabVoiceActive: {
    backgroundColor: '#DB2777'
  },
  modeTabText: {
    color: '#94A3B8',
    fontWeight: '700',
    fontSize: 14
  },
  modeTabTextActive: {
    color: '#FFFFFF'
  },
  voiceRecorderBox: {
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(236,72,153,0.3)'
  },
  recordCircleBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#DB2777',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10
  },
  recordCircleBtnActive: {
    backgroundColor: '#EF4444'
  },
  voiceInstruction: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 15,
    textAlign: 'center'
  },
  voiceSubHint: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center'
  },
  previewVoiceBtn: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(244,114,182,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(244,114,182,0.4)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999
  },
  previewVoiceBtnText: {
    color: '#F472B6',
    fontSize: 13,
    fontWeight: '700'
  },
  textInput: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 14,
    padding: 14,
    color: '#F8FAFC',
    fontSize: 15,
    minHeight: 74,
    textAlignVertical: 'top'
  },
  presetsSection: {
    marginTop: 12
  },
  presetsLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6
  },
  presetsRow: {
    flexDirection: 'row',
    gap: 8
  },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999
  },
  presetChipText: {
    color: '#CBD5E1',
    fontSize: 12
  },
  repeatChipActive: {
    backgroundColor: '#0284C7',
    borderColor: '#38BDF8'
  },
  advancedToggleBtn: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6
  },
  advancedToggleText: {
    color: '#A5B4FC',
    fontSize: 12,
    fontWeight: '700'
  },
  advancedPanel: {
    marginTop: 8,
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 10
  },
  advRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap'
  },
  advLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4
  },
  advInput: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#F8FAFC',
    fontSize: 13
  },
  advTogglesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4
  },
  toggleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155'
  },
  toggleChipOn: {
    backgroundColor: '#0284C7',
    borderColor: '#38BDF8'
  },
  toggleChipWarn: {
    backgroundColor: '#FBBF24',
    borderColor: '#F59E0B'
  },
  toggleChipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700'
  },
  aiPreviewBox: {
    marginTop: 14,
    backgroundColor: 'rgba(79,70,229,0.12)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.35)'
  },
  aiPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8
  },
  aiPreviewHeaderText: {
    color: '#A5B4FC',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8
  },
  aiPreviewGrid: {
    gap: 6
  },
  aiPreviewItem: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6
  },
  aiFieldLabel: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600'
  },
  aiFieldValue: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700'
  },
  aiMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4
  },
  metaTag: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6
  },
  metaTagText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '700'
  },
  errorBanner: {
    marginTop: 12,
    backgroundColor: 'rgba(239,68,68,0.14)',
    padding: 10,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  errorBannerText: {
    color: '#FCA5A5',
    fontSize: 13,
    flex: 1
  },
  successBanner: {
    marginTop: 12,
    backgroundColor: 'rgba(16,185,129,0.14)',
    padding: 10,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  successBannerText: {
    color: '#6EE7B7',
    fontSize: 13,
    flex: 1
  },
  submitBtn: {
    marginTop: 16,
    backgroundColor: '#4F46E5',
    paddingVertical: 14,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  submitBtnVoice: {
    backgroundColor: '#DB2777'
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15
  },
  categoryFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999
  },
  categoryFilterText: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '600'
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '800'
  },
  emptyCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 28,
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
  reminderCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  reminderCardDim: {
    opacity: 0.7
  },
  reminderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  reminderTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6
  },
  reminderTypeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5
  },
  catBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6
  },
  catBadgeText: {
    fontSize: 10,
    fontWeight: '800'
  },
  proofBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(251,191,36,0.16)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6
  },
  proofBadgeText: {
    color: '#FBBF24',
    fontSize: 10,
    fontWeight: '800'
  },
  statusBadge: {
    backgroundColor: 'rgba(52,211,153,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6
  },
  statusSnoozed: {
    backgroundColor: 'rgba(251,191,36,0.2)'
  },
  statusBadgeText: {
    color: '#A7F3D0',
    fontSize: 11,
    fontWeight: '700'
  },
  reminderTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4
  },
  reminderRaw: {
    color: '#94A3B8',
    fontSize: 13,
    fontStyle: 'italic',
    marginBottom: 10
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10
  },
  scheduleTimeText: {
    color: '#FDE68A',
    fontSize: 13,
    fontWeight: '600'
  },
  repeatBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(56,189,248,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6
  },
  repeatBadgeText: {
    color: '#7DD3FC',
    fontSize: 11,
    fontWeight: '800'
  },
  locBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(244,114,182,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6
  },
  locBadgeText: {
    color: '#F472B6',
    fontSize: 11,
    fontWeight: '700'
  },
  delegateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(165,180,252,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6
  },
  delegateBadgeText: {
    color: '#A5B4FC',
    fontSize: 11,
    fontWeight: '700'
  },
  inlineSubtasks: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    gap: 6
  },
  inlineSubtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  inlineSubtaskText: {
    color: '#E2E8F0',
    fontSize: 13
  },
  actionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 12
  },
  voicePlayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(244,114,182,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8
  },
  voicePlayChipText: {
    color: '#F472B6',
    fontSize: 12,
    fontWeight: '700'
  },
  gcalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(56,189,248,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8
  },
  gcalChipText: {
    color: '#7DD3FC',
    fontSize: 12,
    fontWeight: '700'
  },
  testRingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(251,191,36,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8
  },
  testRingText: {
    color: '#FBBF24',
    fontSize: 12,
    fontWeight: '700'
  },
  doneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(52,211,153,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8
  },
  doneChipText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '700'
  },
  deleteIconBtn: {
    marginLeft: 'auto',
    padding: 6
  },
  completedTitle: {
    color: '#CBD5E1',
    fontSize: 15,
    fontWeight: '700',
    textDecorationLine: 'line-through'
  },
  completedBadge: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: '800'
  }
});
