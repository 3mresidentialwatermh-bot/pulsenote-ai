import { Platform } from 'react-native';

function resolveApiBaseUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    // When running via Expo dev server on 8081, point to port 4000 on the same host (works on LAN IP too).
    // When served directly from port 4000 or a public tunnel (ngrok/cloudflare), use the same origin!
    if (window.location.port === '8081') {
      return `${window.location.protocol}//${window.location.hostname}:4000`;
    }
    return window.location.origin;
  }
  return Platform.OS === 'android'
    ? 'http://10.0.2.2:4000'
    : 'http://localhost:4000';
}

export const API_BASE_URL = resolveApiBaseUrl();

export async function apiRequest(endpoint, { method = 'GET', token = null, body = null, isFormData = false } = {}) {
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (!isFormData && body) {
    headers['Content-Type'] = 'application/json';
  }

  const config = {
    method,
    headers
  };

  if (body) {
    config.body = isFormData ? body : JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, config);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const err = new Error(data.error || `Request failed with status ${response.status}`);
    err.code = data.code;
    err.status = response.status;
    throw err;
  }

  return data;
}
