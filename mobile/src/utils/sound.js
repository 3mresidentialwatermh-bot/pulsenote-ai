import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import { API_BASE_URL } from '../config/api';

let alarmInterval = null;
let webAudioCtx = null;
let currentVoiceSound = null;
let escalationStep = 0;

/**
 * Plays synthesized alarm sound profile with progressive volume escalation:
 * - 'gentle': Soft warm marimba/harmonic chimes (528Hz -> 660Hz -> 792Hz)
 * - 'classic': Standard digital alarm pulse (880Hz -> 1108Hz -> 1318Hz)
 * - 'siren': High-urgency alternating emergency siren (700Hz <-> 1400Hz)
 */
function playTonePattern(profile = 'classic', step = 0) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!webAudioCtx) {
        webAudioCtx = new AudioContext();
      }
      if (webAudioCtx.state === 'suspended') {
        webAudioCtx.resume();
      }

      // Gradual volume escalation over the first 5 rings (from 0.12 up to 0.45)
      const volume = Math.min(0.45, 0.12 + step * 0.07);
      const now = webAudioCtx.currentTime;

      if (profile === 'gentle') {
        const freqs = [528, 660, 792, 1056];
        freqs.forEach((freq, idx) => {
          const osc = webAudioCtx.createOscillator();
          const gain = webAudioCtx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + idx * 0.24);
          gain.gain.setValueAtTime(volume * 0.8, now + idx * 0.24);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.24 + 0.22);
          osc.connect(gain);
          gain.connect(webAudioCtx.destination);
          osc.start(now + idx * 0.24);
          osc.stop(now + idx * 0.24 + 0.23);
        });
      } else if (profile === 'siren') {
        const osc = webAudioCtx.createOscillator();
        const gain = webAudioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(720, now);
        osc.frequency.linearRampToValueAtTime(1420, now + 0.35);
        osc.frequency.linearRampToValueAtTime(720, now + 0.7);
        osc.frequency.linearRampToValueAtTime(1420, now + 1.05);
        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 1.15);
        osc.connect(gain);
        gain.connect(webAudioCtx.destination);
        osc.start(now);
        osc.stop(now + 1.18);
      } else {
        // 'classic'
        const freqs = [880, 1108.73, 880, 1318.51];
        freqs.forEach((freq, idx) => {
          const osc = webAudioCtx.createOscillator();
          const gain = webAudioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.16);
          gain.gain.setValueAtTime(volume, now + idx * 0.16);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.16 + 0.14);
          osc.connect(gain);
          gain.connect(webAudioCtx.destination);
          osc.start(now + idx * 0.16);
          osc.stop(now + idx * 0.16 + 0.15);
        });
      }
    } catch (e) {}
  }
}

export function previewAlarmTone(profile = 'classic') {
  playTonePattern(profile, 3);
}

export function speakTextAloud(text) {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new window.SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.03;
      window.speechSynthesis.speak(utterance);
    } catch (e) {}
  }
}

export function speakReminderTTS(title, userName = '') {
  const greeting = userName ? `Hey ${userName.split(' ')[0]}, ` : 'Reminder: ';
  speakTextAloud(`${greeting}it is time to ${title}`);
}

export function stopSpokenTTS() {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch (e) {}
  }
}

export function startAlarmRinging(reminder = null, userName = '', defaultTone = 'classic') {
  stopAlarmRinging();
  escalationStep = 0;
  const toneProfile = reminder?.alarm_tone || defaultTone || 'classic';

  // If user chose 'voice_loop' and the reminder has a recorded voice note, continuously loop their own recorded voice!
  if (toneProfile === 'voice_loop' && reminder?.audio_url) {
    playVoiceNoteUrl(reminder.audio_url);
    alarmInterval = setInterval(() => {
      playVoiceNoteUrl(reminder.audio_url);
    }, 4500);
    return;
  }

  playTonePattern(toneProfile, escalationStep);
  if (reminder && reminder.tts_enabled !== 0) {
    speakReminderTTS(reminder.title, userName);
  }
  alarmInterval = setInterval(() => {
    escalationStep += 1;
    playTonePattern(toneProfile, escalationStep);
    // Re-announce spoken TTS every 4th ring cycle if still unanswered
    if (reminder && reminder.tts_enabled !== 0 && escalationStep % 4 === 0) {
      speakReminderTTS(reminder.title, userName);
    }
  }, 1800);
}

export function stopAlarmRinging() {
  if (alarmInterval) {
    clearInterval(alarmInterval);
    alarmInterval = null;
  }
  escalationStep = 0;
  stopSpokenTTS();
}

export async function playVoiceNoteUrl(audioUrl, onFinish) {
  try {
    await stopVoiceNotePlayback();
    if (!audioUrl) {
      if (onFinish) onFinish();
      return;
    }

    const fullUrl = audioUrl.startsWith('http') || audioUrl.startsWith('data:') || audioUrl.startsWith('blob:')
      ? audioUrl
      : `${API_BASE_URL}${audioUrl}`;

    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.Audio) {
      const htmlAudio = new window.Audio(fullUrl);
      currentVoiceSound = {
        unloadAsync: async () => {
          htmlAudio.pause();
          htmlAudio.currentTime = 0;
        }
      };
      htmlAudio.onended = () => {
        currentVoiceSound = null;
        if (onFinish) onFinish();
      };
      htmlAudio.onerror = () => {
        currentVoiceSound = null;
        if (onFinish) onFinish();
      };
      await htmlAudio.play();
      return;
    }

    const { sound } = await Audio.Sound.createAsync(
      { uri: fullUrl },
      { shouldPlay: true }
    );
    currentVoiceSound = sound;

    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.didJustFinish) {
        sound.unloadAsync();
        currentVoiceSound = null;
        if (onFinish) onFinish();
      }
    });
  } catch (err) {
    console.warn('Voice note playback error:', err);
    if (onFinish) onFinish();
  }
}

export async function stopVoiceNotePlayback() {
  if (currentVoiceSound) {
    try {
      await currentVoiceSound.unloadAsync();
    } catch (e) {}
    currentVoiceSound = null;
  }
}
