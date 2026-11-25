import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useReminders } from '../context/ReminderContext';

export default function SubscriptionScreen() {
  const { user, updateSubscription, updatePreferences, logout } = useAuth();
  const { reminders } = useReminders();

  const [updating, setUpdating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [paymentGateway, setPaymentGateway] = useState('Stripe Card •••• 4242');

  // Quiet Hours & Multi-Channel Escalation local states
  const [quietEnabled, setQuietEnabled] = useState(!!user?.quiet_hours_enabled);
  const [quietStart, setQuietStart] = useState(user?.quiet_hours_start || '22:00');
  const [quietEnd, setQuietEnd] = useState(user?.quiet_hours_end || '08:00');
  const [escWhatsapp, setEscWhatsapp] = useState(!!user?.escalation_whatsapp);
  const [escSms, setEscSms] = useState(!!user?.escalation_sms);
  const [escEmail, setEscEmail] = useState(user?.escalation_email !== 0);
  const [phone, setPhone] = useState(user?.phone_number || '+91 98765 43210');
  const [geminiKey, setGeminiKey] = useState(user?.gemini_api_key || '');

  const currentPlan = user?.plan || 'free';
  const isPaid = currentPlan === 'pro' || currentPlan === 'teams';
  const activeRemindersCount = reminders.filter(
    (r) => r.status === 'pending' || r.status === 'snoozed'
  ).length;

  async function handleSwitchPlan(targetPlan) {
    setUpdating(true);
    setStatusMessage('');
    try {
      const res = await updateSubscription(targetPlan, paymentGateway);
      setStatusMessage(res.message || `Updated plan to ${targetPlan.toUpperCase()}`);
    } catch (err) {
      setStatusMessage(err.message || 'Failed to update subscription');
    } finally {
      setUpdating(false);
    }
  }

  async function handleSavePreferences() {
    setUpdating(true);
    setStatusMessage('');
    try {
      const res = await updatePreferences({
        quiet_hours_enabled: quietEnabled,
        quiet_hours_start: quietStart,
        quiet_hours_end: quietEnd,
        escalation_whatsapp: escWhatsapp,
        escalation_sms: escSms,
        escalation_email: escEmail,
        phone_number: phone,
        gemini_api_key: geminiKey.trim()
      });
      setStatusMessage(res.message || 'Preferences saved!');
    } catch (err) {
      setStatusMessage(err.message || 'Failed to save preferences');
    } finally {
      setUpdating(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.pageTitle}>SaaS Plan, Quiet Hours & Escalations</Text>
      <Text style={styles.pageSub}>
        Configure Quiet Hours, WhatsApp/SMS missed-alarm escalations, and your SaaS billing tier.
      </Text>

      {/* Current Account & Quota Card */}
      <View style={styles.accountCard}>
        <View style={styles.accountHeader}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>
              {(user?.name || 'U').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.accountName}>{user?.name}</Text>
            <Text style={styles.accountEmail}>{user?.email}</Text>
          </View>
          <View
            style={[
              styles.tierPill,
              isPaid ? styles.tierPillPro : styles.tierPillFree
            ]}
          >
            <Ionicons
              name={isPaid ? 'sparkles' : 'person'}
              size={13}
              color="#FFFFFF"
            />
            <Text style={styles.tierPillText}>
              {currentPlan.toUpperCase()} PLAN
            </Text>
          </View>
        </View>

        <View style={styles.usageMetricsRow}>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>AI Voice Notes Used</Text>
            <Text style={styles.metricValue}>
              {user?.voice_quota_used || 0} / {isPaid ? '∞' : user?.voice_quota_limit || 5}
            </Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Active Scheduled Alarms</Text>
            <Text style={styles.metricValue}>
              {activeRemindersCount} / {isPaid ? '∞' : user?.reminder_limit || 10}
            </Text>
          </View>
        </View>
      </View>

      {statusMessage ? (
        <View style={styles.statusBanner}>
          <Ionicons name="checkmark-circle" size={18} color="#34D399" />
          <Text style={styles.statusBannerText}>{statusMessage}</Text>
        </View>
      ) : null}

      {/* Smart Quiet Hours & Multi-Channel Escalation Settings */}
      <View style={styles.settingsCard}>
        <View style={styles.settingsHeader}>
          <Ionicons name="moon" size={18} color="#38BDF8" />
          <Text style={styles.settingsTitle}>
            Quiet Hours & Missed-Alarm Escalation Channels
          </Text>
        </View>
        <Text style={styles.settingsDesc}>
          Automatically shift recurring night alarms (like "drink water every 3 hours") to morning, and send WhatsApp/SMS alerts when an alarm is missed.
        </Text>

        <TouchableOpacity
          style={[styles.toggleRow, quietEnabled && styles.toggleRowActive]}
          onPress={() => setQuietEnabled(!quietEnabled)}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleRowTitle}>
              Enable Quiet Hours (Do Not Disturb Window)
            </Text>
            <Text style={styles.toggleRowSub}>
              Alarms falling inside this window shift to {quietEnd}
            </Text>
          </View>
          <Ionicons
            name={quietEnabled ? 'switch' : 'toggle-outline'}
            size={28}
            color={quietEnabled ? '#34D399' : '#64748B'}
          />
        </TouchableOpacity>

        {quietEnabled && (
          <View style={styles.timeRangeRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>Quiet Start (24h)</Text>
              <TextInput
                style={styles.inputBox}
                value={quietStart}
                onChangeText={setQuietStart}
                placeholder="22:00"
                placeholderTextColor="#64748B"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>Wake-Up / Resume Time</Text>
              <TextInput
                style={styles.inputBox}
                value={quietEnd}
                onChangeText={setQuietEnd}
                placeholder="08:00"
                placeholderTextColor="#64748B"
              />
            </View>
          </View>
        )}

        <Text style={[styles.inputLabel, { marginTop: 14 }]}>
          Escalation Channels When an Alarm is Missed:
        </Text>
        <View style={styles.channelChipsRow}>
          <TouchableOpacity
            style={[styles.channelChip, escWhatsapp && styles.channelChipActive]}
            onPress={() => setEscWhatsapp(!escWhatsapp)}
          >
            <Ionicons
              name="logo-whatsapp"
              size={16}
              color={escWhatsapp ? '#34D399' : '#94A3B8'}
            />
            <Text style={[styles.channelChipText, escWhatsapp && { color: '#FFFFFF' }]}>
              WhatsApp Alert
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.channelChip, escSms && styles.channelChipActive]}
            onPress={() => setEscSms(!escSms)}
          >
            <Ionicons
              name="chatbox-ellipses"
              size={16}
              color={escSms ? '#38BDF8' : '#94A3B8'}
            />
            <Text style={[styles.channelChipText, escSms && { color: '#FFFFFF' }]}>
              SMS Text
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.channelChip, escEmail && styles.channelChipActive]}
            onPress={() => setEscEmail(!escEmail)}
          >
            <Ionicons
              name="mail"
              size={16}
              color={escEmail ? '#A5B4FC' : '#94A3B8'}
            />
            <Text style={[styles.channelChipText, escEmail && { color: '#FFFFFF' }]}>
              Email Escalation
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ marginTop: 10 }}>
          <Text style={styles.inputLabel}>WhatsApp / SMS Phone Number</Text>
          <TextInput
            style={styles.inputBox}
            value={phone}
            onChangeText={setPhone}
            placeholder="+1 800 555 0199"
            placeholderTextColor="#64748B"
          />
        </View>

        <View style={{ marginTop: 12 }}>
          <Text style={[styles.inputLabel, { color: '#A5B4FC' }]}>
            ✨ Google Gemini 2.5 Flash API Key (Real Multimodal Voice & Text AI)
          </Text>
          <TextInput
            style={styles.inputBox}
            value={geminiKey}
            onChangeText={setGeminiKey}
            autoCapitalize="none"
            placeholder="Paste your AIza... key from aistudio.google.com/apikey"
            placeholderTextColor="#64748B"
          />
          <Text style={{ color: '#94A3B8', fontSize: 11, marginTop: 4 }}>
            {geminiKey.trim()
              ? '✓ Real Gemini 2.5 Flash AI active for direct voice-note audio & complex text reasoning!'
              : 'Get a free key at aistudio.google.com/apikey to enable direct Gemini audio transcription & reasoning.'}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.savePrefsBtn}
          onPress={handleSavePreferences}
          disabled={updating}
        >
          <Ionicons name="save-outline" size={17} color="#FFFFFF" />
          <Text style={styles.savePrefsText}>
            Save Quiet Hours & Escalation Settings
          </Text>
        </TouchableOpacity>
      </View>

      {/* Payment Gateway Selector */}
      <View style={styles.gatewayCard}>
        <Text style={styles.inputLabel}>Select SaaS Checkout Method:</Text>
        <View style={styles.channelChipsRow}>
          {[
            'Stripe Card •••• 4242',
            'Razorpay UPI / AutoPay',
            'Apple Pay / Google Pay'
          ].map((gw) => (
            <TouchableOpacity
              key={gw}
              style={[
                styles.channelChip,
                paymentGateway === gw && styles.channelChipActive
              ]}
              onPress={() => setPaymentGateway(gw)}
            >
              <Ionicons
                name="card-outline"
                size={15}
                color={paymentGateway === gw ? '#34D399' : '#94A3B8'}
              />
              <Text
                style={[
                  styles.channelChipText,
                  paymentGateway === gw && { color: '#FFFFFF' }
                ]}
              >
                {gw}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Pricing Tiers Comparison */}
      <View style={styles.tiersContainer}>
        {/* Free Tier */}
        <View style={[styles.planCard, currentPlan === 'free' && styles.planCardCurrent]}>
          <View style={styles.planTopRow}>
            <Text style={styles.planName}>Starter Free</Text>
            <Text style={styles.planPrice}>$0 / mo</Text>
          </View>
          <Text style={styles.planDesc}>
            Essential text & voice task reminders for personal daily tasks.
          </Text>

          <View style={styles.featureList}>
            <FeatureRow text="Up to 10 active scheduled alarms" />
            <FeatureRow text="5 AI Voice Note reminders per month" />
            <FeatureRow text="Natural language date & interval parsing" />
            <FeatureRow text="7-day activity & audit log history" />
          </View>

          <TouchableOpacity
            style={[styles.planBtn, currentPlan === 'free' && styles.planBtnDisabled]}
            disabled={currentPlan === 'free' || updating}
            onPress={() => handleSwitchPlan('free')}
          >
            <Text style={styles.planBtnText}>
              {currentPlan === 'free' ? 'Current Active Plan' : 'Switch to Free'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Pro SaaS Tier */}
        <View
          style={[
            styles.planCard,
            styles.planCardPro,
            currentPlan === 'pro' && styles.planCardCurrentPro
          ]}
        >
          <View style={styles.popularRibbon}>
            <Text style={styles.popularRibbonText}>MOST POPULAR SAAS TIER</Text>
          </View>

          <View style={styles.planTopRow}>
            <Text style={styles.planName}>PulseNote Pro</Text>
            <Text style={[styles.planPrice, { color: '#A5B4FC' }]}>$4.99 / mo</Text>
          </View>
          <Text style={styles.planDesc}>
            Unlimited AI voice notes, Quiet Hours, Spoken TTS, and CSV audit export.
          </Text>

          <View style={styles.featureList}>
            <FeatureRow text="Unlimited active text & voice alarms" />
            <FeatureRow text="Unlimited AI Voice Note capture & playback" />
            <FeatureRow text="Spoken TTS Readout + Wake-Up Math Challenge" />
            <FeatureRow text="Quiet Hours auto-shift & WhatsApp/SMS escalation" />
            <FeatureRow text="Full CSV Audit Log export & Google Calendar sync" />
          </View>

          <TouchableOpacity
            style={[
              styles.planBtnPro,
              currentPlan === 'pro' && styles.planBtnDisabled
            ]}
            disabled={currentPlan === 'pro' || updating}
            onPress={() => handleSwitchPlan('pro')}
          >
            {updating ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="rocket" size={18} color="#FFFFFF" />
                <Text style={styles.planBtnProText}>
                  {currentPlan === 'pro'
                    ? 'Pro Plan Active ✓'
                    : 'Upgrade to Pro ($4.99/mo)'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Family & Teams SaaS Tier */}
        <View
          style={[
            styles.planCard,
            currentPlan === 'teams' && styles.planCardCurrentPro
          ]}
        >
          <View style={[styles.popularRibbon, { backgroundColor: '#0284C7' }]}>
            <Text style={styles.popularRibbonText}>FAMILY & TEAMS COLLABORATION</Text>
          </View>

          <View style={styles.planTopRow}>
            <Text style={styles.planName}>PulseNote Teams</Text>
            <Text style={[styles.planPrice, { color: '#38BDF8' }]}>$12.99 / mo</Text>
          </View>
          <Text style={styles.planDesc}>
            Delegate voice & text reminders to teammates or family members with shared logs.
          </Text>

          <View style={styles.featureList}>
            <FeatureRow text="Everything in PulseNote Pro included" />
            <FeatureRow text="Delegate & assign alarms to any teammate's email" />
            <FeatureRow text="Shared completion audit logs across team" />
            <FeatureRow text="Priority WhatsApp + SMS escalation alerts" />
          </View>

          <TouchableOpacity
            style={[
              styles.planBtnPro,
              { backgroundColor: '#0284C7' },
              currentPlan === 'teams' && styles.planBtnDisabled
            ]}
            disabled={currentPlan === 'teams' || updating}
            onPress={() => handleSwitchPlan('teams')}
          >
            <Ionicons name="people" size={18} color="#FFFFFF" />
            <Text style={styles.planBtnProText}>
              {currentPlan === 'teams'
                ? 'Teams Plan Active ✓'
                : 'Upgrade to Teams ($12.99/mo)'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
        <Ionicons name="log-out-outline" size={18} color="#F87171" />
        <Text style={styles.logoutBtnText}>Sign Out of Account</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function FeatureRow({ text }) {
  return (
    <View style={styles.featureRow}>
      <Ionicons name="checkmark-circle" size={17} color="#34D399" />
      <Text style={styles.featureText}>{text}</Text>
    </View>
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
  pageTitle: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4
  },
  pageSub: {
    color: '#94A3B8',
    fontSize: 13,
    marginBottom: 18
  },
  accountCard: {
    backgroundColor: '#1E293B',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 18
  },
  accountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#4F46E5',
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarInitial: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800'
  },
  accountName: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '700'
  },
  accountEmail: {
    color: '#94A3B8',
    fontSize: 13
  },
  tierPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999
  },
  tierPillFree: {
    backgroundColor: '#475569'
  },
  tierPillPro: {
    backgroundColor: '#4F46E5'
  },
  tierPillText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800'
  },
  usageMetricsRow: {
    flexDirection: 'row',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 14
  },
  metricItem: {
    flex: 1,
    backgroundColor: '#0F172A',
    padding: 12,
    borderRadius: 12
  },
  metricLabel: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 4
  },
  metricValue: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800'
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(16,185,129,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.35)',
    padding: 12,
    borderRadius: 12,
    marginBottom: 18
  },
  statusBannerText: {
    color: '#6EE7B7',
    fontSize: 14,
    fontWeight: '600',
    flex: 1
  },
  settingsCard: {
    backgroundColor: '#1E293B',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 18
  },
  settingsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4
  },
  settingsTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800'
  },
  settingsDesc: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 14
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  toggleRowActive: {
    borderColor: '#34D399'
  },
  toggleRowTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700'
  },
  toggleRowSub: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2
  },
  timeRangeRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12
  },
  inputLabel: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6
  },
  inputBox: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F8FAFC',
    fontSize: 14
  },
  channelChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  channelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10
  },
  channelChipActive: {
    backgroundColor: '#312E81',
    borderColor: '#6366F1'
  },
  channelChipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700'
  },
  savePrefsBtn: {
    marginTop: 14,
    backgroundColor: '#0284C7',
    paddingVertical: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  savePrefsText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700'
  },
  gatewayCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 16
  },
  tiersContainer: {
    gap: 16
  },
  planCard: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155'
  },
  planCardCurrent: {
    borderColor: '#64748B'
  },
  planCardPro: {
    borderColor: '#4F46E5',
    backgroundColor: '#1E1B4B'
  },
  planCardCurrentPro: {
    borderColor: '#818CF8',
    borderWidth: 2
  },
  popularRibbon: {
    alignSelf: 'flex-start',
    backgroundColor: '#4F46E5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 10
  },
  popularRibbonText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8
  },
  planTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 6
  },
  planName: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '800'
  },
  planPrice: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '800'
  },
  planDesc: {
    color: '#94A3B8',
    fontSize: 13,
    marginBottom: 16
  },
  featureList: {
    gap: 10,
    marginBottom: 18
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  featureText: {
    color: '#E2E8F0',
    fontSize: 13
  },
  planBtn: {
    backgroundColor: '#334155',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center'
  },
  planBtnPro: {
    backgroundColor: '#4F46E5',
    paddingVertical: 14,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  planBtnDisabled: {
    opacity: 0.65
  },
  planBtnText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 14
  },
  planBtnProText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15
  },
  logoutBtn: {
    marginTop: 26,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    paddingVertical: 13,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  logoutBtnText: {
    color: '#F87171',
    fontWeight: '700',
    fontSize: 14
  }
});
