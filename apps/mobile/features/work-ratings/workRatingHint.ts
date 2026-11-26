import AsyncStorage from "@react-native-async-storage/async-storage";

// 評価機能の初回説明「評価するとおすすめの精度が上がります」を
// 一度だけ出すための表示済みフラグ（issue #416）。
// issue の決定どおり端末ローカルで十分なので、ユーザー別に分けず
// 端末共通のフラグ 1 つで持つ。
const STORAGE_KEY = "work-rating:hint-shown:v1";

export async function loadWorkRatingHintSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(STORAGE_KEY)) === "1";
  } catch {
    return false;
  }
}

// 書き込みに失敗しても呼び出し側の表示は進める
// （失敗時は次回も説明が出るだけ。friendStorySeen と同じ考え方）。
export async function markWorkRatingHintSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, "1");
  } catch {}
}
