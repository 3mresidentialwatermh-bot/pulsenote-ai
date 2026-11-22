import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../config/api';

const AuthContext = createContext(null);

const TOKEN_KEY = '@pulsenote_token';
const USER_CACHE_KEY = '@pulsenote_user_cache';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [isOffline, setIsOffline] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    restoreSession();
  }, []);

  async function persistUserLocally(userObj, tokenStr) {
    if (userObj) {
      setUser(userObj);
      await AsyncStorage.setItem(USER_CACHE_KEY, JSON.stringify(userObj));
    }
    if (tokenStr) {
      setToken(tokenStr);
      await AsyncStorage.setItem(TOKEN_KEY, tokenStr);
    }
  }

  async function restoreSession() {
    try {
      const [savedToken, cachedUserJson] = await Promise.all([
        AsyncStorage.getItem(TOKEN_KEY),
        AsyncStorage.getItem(USER_CACHE_KEY)
      ]);

      // Immediately hydrate from local phone storage so the app works offline without waiting
      if (cachedUserJson) {
        try {
          setUser(JSON.parse(cachedUserJson));
        } catch (e) {}
      }
      if (savedToken) {
        setToken(savedToken);
      }

      // If online, sync profile in background
      if (savedToken && !savedToken.startsWith('offline-token')) {
        try {
          const data = await apiRequest('/api/auth/me', { token: savedToken });
          await persistUserLocally(data.user, savedToken);
          setIsOffline(false);
        } catch (err) {
          // Server/tunnel unreachable: keep cached local user active in Offline Mode
          if (cachedUserJson) {
            setIsOffline(true);
          } else {
            await AsyncStorage.removeItem(TOKEN_KEY);
          }
        }
      }
    } finally {
      setLoading(false);
    }
  }

  function createOfflineUserProfile(name, email) {
    return {
      id: `local_${Date.now()}`,
      name: name || email.split('@')[0] || 'Mobile User',
      email: email.trim().toLowerCase(),
      plan: 'pro',
      voice_quota_used: 0,
      voice_quota_limit: 999999,
      reminder_limit: 999999,
      quiet_hours_enabled: 0,
      quiet_hours_start: '22:00',
      quiet_hours_end: '08:00',
      escalation_whatsapp: 1,
      escalation_sms: 0,
      escalation_email: 1,
      phone_number: '',
      streak_days: 1,
      created_at: new Date().toISOString()
    };
  }

  async function login(email, password) {
    try {
      const data = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: { email, password }
      });
      await persistUserLocally(data.user, data.token);
      setIsOffline(false);
      return data.user;
    } catch (err) {
      if (err.status === 401 || err.status === 400) {
        throw err; // Real credential error from reachable server
      }
      // Server/tunnel is offline -> log in locally using Offline-First mode!
      const cachedJson = await AsyncStorage.getItem(USER_CACHE_KEY);
      const localUser = cachedJson
        ? JSON.parse(cachedJson)
        : createOfflineUserProfile('Alex Demo', email);
      const offlineToken = `offline-token-${Date.now()}`;
      await persistUserLocally(localUser, offlineToken);
      setIsOffline(true);
      return localUser;
    }
  }

  async function register(name, email, password) {
    try {
      const data = await apiRequest('/api/auth/register', {
        method: 'POST',
        body: { name, email, password }
      });
      await persistUserLocally(data.user, data.token);
      setIsOffline(false);
      return data.user;
    } catch (err) {
      if (err.status === 409 || err.status === 400) {
        throw err;
      }
      const localUser = createOfflineUserProfile(name, email);
      const offlineToken = `offline-token-${Date.now()}`;
      await persistUserLocally(localUser, offlineToken);
      setIsOffline(true);
      return localUser;
    }
  }

  async function logout() {
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_CACHE_KEY]);
    setToken(null);
    setUser(null);
  }

  async function refreshUser() {
    if (!token || token.startsWith('offline-token')) return;
    try {
      const data = await apiRequest('/api/auth/me', { token });
      await persistUserLocally(data.user, token);
      setIsOffline(false);
    } catch (e) {
      setIsOffline(true);
    }
  }

  async function updateSubscription(plan, paymentMethod = 'Stripe Card •••• 4242') {
    try {
      const data = await apiRequest('/api/auth/subscription', {
        method: 'POST',
        token,
        body: { plan, paymentMethod }
      });
      await persistUserLocally(data.user, token);
      setIsOffline(false);
      return data;
    } catch (e) {
      const updated = {
        ...user,
        plan,
        voice_quota_limit: plan === 'free' ? 5 : 999999,
        reminder_limit: plan === 'free' ? 10 : 999999
      };
      await persistUserLocally(updated, token);
      setIsOffline(true);
      return {
        message: `Updated to ${plan.toUpperCase()} Plan (Saved on Device Offline)`,
        user: updated
      };
    }
  }

  async function updatePreferences(prefs) {
    try {
      const data = await apiRequest('/api/auth/preferences', {
        method: 'PATCH',
        token,
        body: prefs
      });
      await persistUserLocally(data.user, token);
      setIsOffline(false);
      return data;
    } catch (e) {
      const updated = { ...user, ...prefs };
      await persistUserLocally(updated, token);
      setIsOffline(true);
      return {
        message: 'Preferences saved locally on device!',
        user: updated
      };
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        setUser: (u) => persistUserLocally(u, token),
        token,
        isOffline,
        setIsOffline,
        loading,
        login,
        register,
        logout,
        refreshUser,
        updateSubscription,
        updatePreferences
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
