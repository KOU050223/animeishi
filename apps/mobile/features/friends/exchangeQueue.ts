import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MiniMeishi } from "@/features/friends/qrParser";

// 読み取り側の交換キュー（issue #681、設計 docs/13_offline-exchange-design.md）。
// スキャン時に POST /me/friends がネットワークへ届かない（オフライン等）場合、
// スキャン結果をここに積み、通信復帰後に useExchangeQueueSync が順に送る。
// POST は冪等（onConflictDoNothing）なので重複送信は問題ない。
const STORAGE_KEY = "exchangeQueue:v1";

export type ExchangeQueueItem = {
  /** キュー内で項目を識別する ID。送信後の削除に使う。 */
  id: string;
  /** スキャンした相手のユーザー ID。 */
  friendId: string;
  /** 対面交換 QR の短期トークン（`?qt=`）。ot しか載っていない QR では undefined。 */
  qrToken?: string | undefined;
  /** オフライン交換用の長寿命トークン（`?ot=`、issue #663）。 */
  offlineToken?: string | undefined;
  /** ミニ名刺（`?mc=`）。キュー失敗時の通知で相手の名前を出すために保持する。 */
  miniMeishi?: MiniMeishi | undefined;
  /**
   * スキャンした時刻（ISO 8601）。成立時刻と交換時刻がずれるため、
   * 交換記録（issue #661）の「実際に会った日時」としてサーバーへ送る。
   * クライアント時計は信用できないためサーバー側で採用範囲が絞られ、
   * セキュリティ判断には使わない。
   */
  scannedAt: string;
};

export type NewExchangeQueueItem = Omit<
  ExchangeQueueItem,
  "id" | "scannedAt"
> & {
  /**
   * スキャンした時刻（ISO 8601）。省略時は登録時刻を使う
   * （キューへの登録はスキャン直後の POST 失敗時に行われるため実質同じ時刻）。
   */
  scannedAt?: string | undefined;
};

// Date.now だけだと同一ミリ秒の連続登録で衝突するためカウンタを併用する。
let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `${Date.now()}-${idCounter}`;
}

/** 保存されているキューを読み出す。壊れた JSON・不正な形は空キュー扱い。 */
export async function readExchangeQueue(): Promise<ExchangeQueueItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ExchangeQueueItem =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as ExchangeQueueItem).id === "string" &&
        typeof (item as ExchangeQueueItem).friendId === "string" &&
        typeof (item as ExchangeQueueItem).scannedAt === "string",
    );
  } catch {
    return [];
  }
}

/**
 * スキャン結果をキューへ積む。
 * 同じ相手を複数回スキャンしても成立は冪等なため、既存項目は新しい
 * スキャンで置き換える（トークン・scannedAt は新しいほうが正確）。
 * 保存に失敗した場合は呼び出し側に例外を返す（キューできたと誤表示しない）。
 */
export async function enqueueExchange(
  item: NewExchangeQueueItem,
): Promise<ExchangeQueueItem> {
  const queue = await readExchangeQueue();
  const entry: ExchangeQueueItem = {
    ...item,
    scannedAt: item.scannedAt ?? new Date().toISOString(),
    id: nextId(),
  };
  const next = [
    ...queue.filter((queued) => queued.friendId !== item.friendId),
    entry,
  ];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return entry;
}

/** id 指定で項目を削除する。flush 中の enqueue による項目消失を避けるため差分更新する。 */
async function removeExchangeItems(ids: ReadonlySet<string>): Promise<void> {
  const queue = await readExchangeQueue();
  const next = queue.filter((item) => !ids.has(item.id));
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

/**
 * send の結果分類。
 * - "sent": 成立した。項目を削除する。
 * - "discard": 期限切れ・無効など再送しても成立しない。項目を破棄し通知対象にする。
 * - "retry": ネットワーク未到達や 5xx など一時的失敗。項目を残して残りの送信も打ち切る
 *   （通信が戻っていないのに後続項目を順に試しても同じく失敗するため）。
 */
export type ExchangeSendOutcome = "sent" | "discard" | "retry";

export type FlushExchangeResult = {
  /** 送信が成立した項目。 */
  sent: ExchangeQueueItem[];
  /** 期限切れ・無効で破棄した項目。 */
  discarded: ExchangeQueueItem[];
  /** 送信できずキューに残った項目数（retry で打ち切った分を含む）。 */
  remaining: number;
};

/**
 * キューを先頭から順に send で送る。
 * send は例外を投げてもよい（その場合は retry 扱いで残りを打ち切る）。
 */
export async function flushExchangeQueue(options: {
  send: (item: ExchangeQueueItem) => Promise<ExchangeSendOutcome>;
}): Promise<FlushExchangeResult> {
  const queue = await readExchangeQueue();
  const sent: ExchangeQueueItem[] = [];
  const discarded: ExchangeQueueItem[] = [];
  const removedIds = new Set<string>();

  for (const item of queue) {
    let outcome: ExchangeSendOutcome;
    try {
      outcome = await options.send(item);
    } catch {
      outcome = "retry";
    }
    if (outcome === "retry") break;
    removedIds.add(item.id);
    (outcome === "sent" ? sent : discarded).push(item);
  }

  if (removedIds.size > 0) {
    await removeExchangeItems(removedIds);
  }
  return { sent, discarded, remaining: queue.length - removedIds.size };
}
