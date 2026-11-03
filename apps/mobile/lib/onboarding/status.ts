import AsyncStorage from "@react-native-async-storage/async-storage";

// 初回オンボーディング（issue #412）の完了/スキップ記録。端末ローカルで持つ。
// キーはユーザーごとに分離する（同じ端末でアカウントを切り替えても
// 混ざらないようにする。friendStorySeen と同じ方式）。
// 記録の役割は「もうオンボーディングを見せない」こと。表示のエントリは
// サインアップ直後の遷移（onboardingPending）だけなので、既存ユーザーや
// 2 回目以降の起動には出ない。
const storageKey = (userId: string) => `onboarding:status:v1:${userId}`;

export type OnboardingStatus = "completed" | "skipped";

export type OnboardingRecord = {
  status: OnboardingStatus;
  /** 完了/スキップした時刻（epoch ms）。 */
  finishedAt: number;
};

export async function loadOnboardingStatus(
  userId: string,
): Promise<OnboardingRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const rec = parsed as Partial<OnboardingRecord>;
    if (rec.status !== "completed" && rec.status !== "skipped") return null;
    return {
      status: rec.status,
      finishedAt: typeof rec.finishedAt === "number" ? rec.finishedAt : 0,
    };
  } catch {
    return null;
  }
}

// 書き込み失敗は握り潰す。記録が残らなくても次回のエントリは
// サインアップ直後の遷移だけなので、機能上の不整合にはならない。
export async function saveOnboardingStatus(
  userId: string,
  status: OnboardingStatus,
): Promise<void> {
  try {
    const record: OnboardingRecord = { status, finishedAt: Date.now() };
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(record));
  } catch {}
}
