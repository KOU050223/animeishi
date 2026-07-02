import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MeishiDocument } from "./types";

const STORAGE_KEY = "meishi-document:v1";

export async function loadMeishiDocument(): Promise<MeishiDocument | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
      return null;
    }
    return parsed as MeishiDocument;
  } catch {
    return null;
  }
}

export async function saveMeishiDocument(doc: MeishiDocument): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch {
    // ドラフト保護失敗は握りつぶす（次回保存時にリトライされる）
  }
}

export async function clearMeishiDocument(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {}
}
