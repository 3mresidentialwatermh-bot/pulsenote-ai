import React, { useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  StatusBar as RNStatusBar
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { ReminderProvider, useReminders } from './src/context/ReminderContext';
import AuthScreen from './src/screens/AuthScreen';
import HomeScreen from './src/screens/HomeScreen';
import LogsScreen from './src/screens/LogsScreen';
import SubscriptionScreen from './src/screens/SubscriptionScreen';
import AlarmModal from './src/components/AlarmModal';

function MainShell() {
  const { user, loading, isOffline } = useAuth();
  const { reminders, logs } = useReminders();
  const [activeTab, setActiveTab] = useState('home'); // 'home' | 'logs' | 'subscription'

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#6366F1" />
        <Text style={styles.loadingText}>Loading PulseNote AI SaaS...</Text>
      </View>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  const activeAlarmsCount = reminders.filter(
    (r) => r.status === 'pending' || r.status === 'snoozed'
  ).length;

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <View style={styles.headerBrand}>
          <View style={styles.headerIcon}>
            <Ionicons name="mic" size={20} color="#FFFFFF" />
          </View>
          <View>
            <Text style={styles.headerTitle}>PulseNote AI</Text>
            <Text style={styles.headerSubtitle}>
              {isOffline
                ? '⚡ On-Device Offline Mode Active'
                : '☁️ Cloud Synced • Voice & Text AI'}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.headerTierChip,
            user.plan === 'pro' && styles.headerTierChipPro
          ]}
          onPress={() => setActiveTab('subscription')}
        >
          <Ionicons
            name={user.plan === 'pro' ? 'sparkles' : 'person-circle-outline'}
            size={15}
            color="#FFFFFF"
          />
          <Text style={styles.headerTierText}>
            {user.plan === 'pro' ? 'PRO' : 'FREE'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Active Screen Content */}
      <View style={styles.body}>
        {activeTab === 'home' && <HomeScreen onNavigateTab={setActiveTab} />}
        {activeTab === 'logs' && <LogsScreen />}
        {activeTab === 'subscription' && <SubscriptionScreen />}
      </View>

      {/* Persistent Full-Screen Alarm Overlay */}
      <AlarmModal />

      {/* Bottom Mobile Navigation Bar */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('home')}
        >
          <View style={styles.navIconWrap}>
            <Ionicons
              name={activeTab === 'home' ? 'alarm' : 'alarm-outline'}
              size={22}
              color={activeTab === 'home' ? '#818CF8' : '#64748B'}
            />
            {activeAlarmsCount > 0 && (
              <View style={styles.navBadge}>
                <Text style={styles.navBadgeText}>{activeAlarmsCount}</Text>
              </View>
            )}
          </View>
          <Text
            style={[
              styles.navLabel,
              activeTab === 'home' && styles.navLabelActive
            ]}
          >
            Reminders & Voice
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('logs')}
        >
          <View style={styles.navIconWrap}>
            <Ionicons
              name={
                activeTab === 'logs' ? 'list-circle' : 'list-circle-outline'
              }
              size={22}
              color={activeTab === 'logs' ? '#818CF8' : '#64748B'}
            />
            {logs.length > 0 && (
              <View style={[styles.navBadge, { backgroundColor: '#334155' }]}>
                <Text style={styles.navBadgeText}>{logs.length}</Text>
              </View>
            )}
          </View>
          <Text
            style={[
              styles.navLabel,
              activeTab === 'logs' && styles.navLabelActive
            ]}
          >
            Audit Log
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('subscription')}
        >
          <Ionicons
            name={activeTab === 'subscription' ? 'diamond' : 'diamond-outline'}
            size={22}
            color={activeTab === 'subscription' ? '#818CF8' : '#64748B'}
          />
          <Text
            style={[
              styles.navLabel,
              activeTab === 'subscription' && styles.navLabelActive
            ]}
          >
            SaaS Plan
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ReminderProvider>
        <StatusBar style="light" />
        <MainShell />
      </ReminderProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0F172A',
    paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#334155'
  },
  headerBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#4F46E5',
    alignItems: 'center',
    justifyContent: 'center'
  },
  headerTitle: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '800'
  },
  headerSubtitle: {
    color: '#94A3B8',
    fontSize: 11
  },
  headerTierChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999
  },
  headerTierChipPro: {
    backgroundColor: '#4F46E5'
  },
  headerTierText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800'
  },
  body: {
    flex: 1
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingVertical: 10,
    paddingHorizontal: 12
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4
  },
  navIconWrap: {
    position: 'relative'
  },
  navBadge: {
    position: 'absolute',
    top: -5,
    right: -12,
    backgroundColor: '#4F46E5',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 999,
    minWidth: 18,
    alignItems: 'center'
  },
  navBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800'
  },
  navLabel: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600'
  },
  navLabelActive: {
    color: '#818CF8',
    fontWeight: '700'
  }
});
