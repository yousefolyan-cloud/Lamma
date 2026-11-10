import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
export const configError = !url || !anon ? 'config_missing' : null;

// Session tokens live in the Keychain / Keystore on devices. Tokens can exceed SecureStore's
// per-item size, so they are stored in chunks.
const CHUNK = 1800;
const secureStorage = {
  async getItem(key: string) {
    const n = Number(await SecureStore.getItemAsync(`${key}.n`));
    if (!n) return null;
    const parts = await Promise.all(Array.from({ length: n }, (_, i) => SecureStore.getItemAsync(`${key}.${i}`)));
    return parts.some((p) => p == null) ? null : parts.join('');
  },
  async setItem(key: string, value: string) {
    const n = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < n; i++) await SecureStore.setItemAsync(`${key}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    await SecureStore.setItemAsync(`${key}.n`, String(n));
  },
  async removeItem(key: string) {
    const n = Number(await SecureStore.getItemAsync(`${key}.n`));
    for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
    await SecureStore.deleteItemAsync(`${key}.n`);
  },
};
const safeKey = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, '_');
const storage = Platform.OS === 'web' ? AsyncStorage : {
  getItem: (k: string) => secureStorage.getItem(safeKey(k)),
  setItem: (k: string, v: string) => secureStorage.setItem(safeKey(k), v),
  removeItem: (k: string) => secureStorage.removeItem(safeKey(k)),
};

export const supabase: SupabaseClient = createClient(url ?? 'http://localhost', anon ?? 'missing', {
  auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});
