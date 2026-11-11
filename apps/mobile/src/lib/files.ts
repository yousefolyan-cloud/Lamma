// Evidence files (driver documents, scale-check proof). Stored in the private "evidence" bucket under driver/<user id>/…;
// Storage policies decide who may add or read them, never this file.
import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';
import { ApiError } from './api';

const BUCKET = 'evidence';
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export interface PickedFile { uri: string; mime: string }

/** Lets the person choose a photo. Returns null when they cancel. */
export async function pickImage(): Promise<PickedFile | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  const mime = a.mimeType && EXT[a.mimeType] ? a.mimeType : 'image/jpeg';
  return { uri: a.uri, mime };
}

/** Uploads into the caller's own folder and returns the stored path. */
export async function uploadEvidence(file: PickedFile): Promise<string> {
  const { data: s } = await supabase.auth.getSession();
  const uid = s.session?.user.id;
  if (!uid) throw new ApiError('not_authorized', 'no session');
  const id = (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `driver/${uid}/${id}.${EXT[file.mime] ?? 'jpg'}`;
  const body = await (await fetch(file.uri)).arrayBuffer();
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType: file.mime, upsert: false });
  if (error) throw new ApiError('upload_failed', error.message);
  return path;
}

/** Short-lived link to view a stored file (only works for people the Storage policy lets read it). */
export async function evidenceUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 120);
  if (error || !data) throw new ApiError('file_unavailable', error?.message ?? 'no url');
  return data.signedUrl;
}
