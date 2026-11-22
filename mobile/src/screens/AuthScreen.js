import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';

export default function AuthScreen() {
  const { login, register } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError('');
    if (!email.trim() || !password.trim() || (!isLogin && !name.trim())) {
      setError('Please fill in all required fields.');
      return;
    }

    setSubmitting(true);
    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(name, email, password);
      }
    } catch (err) {
      setError(err.message || 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleQuickDemoAccount() {
    setError('');
    setSubmitting(true);
    const demoEmail = 'demo@pulsenote.ai';
    const demoPass = 'demo1234';
    try {
      await login(demoEmail, demoPass);
    } catch (e) {
      try {
        await register('Alex Demo', demoEmail, demoPass);
      } catch (regErr) {
        setError(regErr.message || 'Could not sign into demo account.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <View style={styles.brandRow}>
            <View style={styles.logoCircle}>
              <Ionicons name="mic" size={28} color="#FFFFFF" />
            </View>
            <View>
              <Text style={styles.brandName}>PulseNote AI</Text>
              <Text style={styles.brandTagline}>
                Voice & Text Smart Reminder SaaS
              </Text>
            </View>
          </View>

          <View style={styles.featurePills}>
            <View style={styles.pill}>
              <Ionicons name="chatbubble-ellipses" size={14} color="#6366F1" />
              <Text style={styles.pillText}>Text NLP</Text>
            </View>
            <View style={styles.pill}>
              <Ionicons name="mic" size={14} color="#EC4899" />
              <Text style={styles.pillText}>Voice Notes</Text>
            </View>
            <View style={styles.pill}>
              <Ionicons name="alarm" size={14} color="#F59E0B" />
              <Text style={styles.pillText}>Smart Alarms & Logs</Text>
            </View>
          </View>

          <View style={styles.tabSwitch}>
            <TouchableOpacity
              style={[styles.tabBtn, isLogin && styles.tabBtnActive]}
              onPress={() => {
                setIsLogin(true);
                setError('');
              }}
            >
              <Text style={[styles.tabText, isLogin && styles.tabTextActive]}>
                Sign In
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabBtn, !isLogin && styles.tabBtnActive]}
              onPress={() => {
                setIsLogin(false);
                setError('');
              }}
            >
              <Text style={[styles.tabText, !isLogin && styles.tabTextActive]}>
                Create Account
              </Text>
            </TouchableOpacity>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={18} color="#EF4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {!isLogin && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Full Name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Sushil Bhagat"
                placeholderTextColor="#94A3B8"
                value={name}
                onChangeText={setName}
              />
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address</Text>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor="#94A3B8"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor="#94A3B8"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Text style={styles.primaryBtnText}>
                  {isLogin ? 'Sign In to Workspace' : 'Start Free SaaS Trial'}
                </Text>
                <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.demoBtn}
            onPress={handleQuickDemoAccount}
            disabled={submitting}
          >
            <Ionicons name="sparkles" size={16} color="#4F46E5" />
            <Text style={styles.demoBtnText}>
              One-Tap Instant Demo Login (demo@pulsenote.ai)
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0F172A'
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20
  },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 28,
    borderWidth: 1,
    borderColor: '#334155'
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 18
  },
  logoCircle: {
    width: 54,
    height: 54,
    borderRadius: 16,
    backgroundColor: '#4F46E5',
    alignItems: 'center',
    justifyContent: 'center'
  },
  brandName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#F8FAFC'
  },
  brandTagline: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 2
  },
  featurePills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 22
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155'
  },
  pillText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600'
  },
  tabSwitch: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center'
  },
  tabBtnActive: {
    backgroundColor: '#4F46E5'
  },
  tabText: {
    color: '#94A3B8',
    fontWeight: '600',
    fontSize: 14
  },
  tabTextActive: {
    color: '#FFFFFF'
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderColor: 'rgba(239,68,68,0.3)',
    borderWidth: 1,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 13,
    flex: 1
  },
  inputGroup: {
    marginBottom: 16
  },
  label: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6
  },
  input: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#F8FAFC',
    fontSize: 15
  },
  primaryBtn: {
    backgroundColor: '#4F46E5',
    paddingVertical: 14,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 6
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16
  },
  demoBtn: {
    marginTop: 14,
    backgroundColor: 'rgba(79,70,229,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.35)',
    paddingVertical: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  demoBtnText: {
    color: '#A5B4FC',
    fontWeight: '600',
    fontSize: 13
  }
});
