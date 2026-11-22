import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import { API_BASE_URL } from '../config/api';

let alarmInterval = null;
let webAudioCtx = null;
let currentVoiceSound = null;

function playBeepSequence() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!webAudioCtx) {
        webAudioCtx = new AudioContext();
      }
      if (webAudioCtx.state === 'suspended') {
        webAudioCtx.resume();
      }

      const now = webAudioCtx.currentTime;
      const freqs = [880, 1108.73, 880, 1318.51];
      freqs.forEach((freq, idx) => {
        const osc = webAudioCtx.createOscillator();
        const gain = webAudioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.16);
        gain.gain.setValueAtTime(0.25, now + idx * 0.16);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.16 + 0.14);
        osc.connect(gain);
        gain.connect(webAudioCtx.destination);
        osc.start(now + idx * 0.16);
        osc.stop(now + idx * 0.16 + 0.15);
      });
    } catch (e) {
      // Ignore Web Audio restriction errors until user interacts
    }
  }
}

export function speakReminderTTS(title, userName = '') {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
      const greeting = userName ? `Hey ${userName.split(' ')[0]}, ` : 'Reminder: ';
      const utterance = new window.SpeechSynthesisUtterance(
        `${greeting}it is time to ${title}`
      );
      utterance.rate = 1.0;
      utterance.pitch = 1.05;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      // ignore
    }
  }
}

export function stopSpokenTTS() {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch (e) {}
  }
}

export function startAlarmRinging(reminder = null, userName = '') {
  stopAlarmRinging();
  playBeepSequence();
  if (reminder && reminder.tts_enabled !== 0) {
    speakReminderTTS(reminder.title, userName);
  }
  alarmInterval = setInterval(() => {
    playBeepSequence();
  }, 1800);
}

export function stopAlarmRinging() {
  if (alarmInterval) {
    clearInterval(alarmInterval);
    alarmInterval = null;
  }
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
    } catch (e) {
      // ignore
    }
    currentVoiceSound = null;
  }
}
