import AsyncStorage from "@react-native-async-storage/async-storage";

// ストーリーの既読状態（issue #266）。端末ローカルで持つ。
// 「そのフレンドのどの活動まで見たか」を最新の活動 id で記録し、
// それより新しい活動があるフレンドを未読としてリングの色を変える。
const STORAGE_KEY = "friend-watch-stories:seen:v1";

/** friendUserId → 既読にした最新の活動 id。 */
export type StorySeenMap = Record<string, number>;

export async function loadStorySeenMap(): Promise<StorySeenMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const map: StorySeenMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      // 壊れた値だけ落として残りは復旧する
      if (typeof value === "number" && Number.isFinite(value)) {
        map[key] = value;
      }
    }
    return map;
  } catch {
    return {};
  }
}

// 最新の既読状態を返す。AsyncStorage への書き込みに失敗しても
// 呼び出し側の表示は新しい状態に進める（失敗時は次回読み込みで未読に戻るだけ）。
export async function markStorySeen(
  friendUserId: string,
  latestActivityId: number,
): Promise<StorySeenMap> {
  const map = await loadStorySeenMap();
  if ((map[friendUserId] ?? 0) >= latestActivityId) return map;
  const next = { ...map, [friendUserId]: latestActivityId };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

// フレンドの最新活動 id が既読済みの id より新しければ未読。
export function isFriendUnread(
  friend: { actor: { userId: string }; items: { id: number }[] },
  seenMap: StorySeenMap,
): boolean {
  const latestId = Math.max(...friend.items.map((item) => item.id));
  return latestId > (seenMap[friend.actor.userId] ?? 0);
}
