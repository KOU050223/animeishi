import { useEffect, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { alert, confirm } from "@/lib/dialog";
import {
  useDeleteFriendThanks,
  useFriendThanksFor,
  useMarkFriendThanksRead,
  useSendFriendThanks,
  THANKS_PRESET_TEXT,
  type ReceivedThanksItem,
  type SentThanksItem,
  type ThanksPresetKey,
} from "@/lib/useFriendThanks";
import { FriendThanksSheet } from "./FriendThanksSheet";

// 「2026年11月21日」形式。解釈できない値は空文字。
function formatThanksDate(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

// 日本時間の暦日で「今日送った分」があるか。API の 1 日 1 通制限は
// JST 基準なので、ボタンを押す前に同じ基準で送付済みかを知らせる。
const jstDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" });
function sentTodayJst(items: SentThanksItem[]): boolean {
  const today = jstDay.format(new Date());
  return items.some((i) => jstDay.format(new Date(i.createdAt)) === today);
}

/**
 * 名刺帳の相手詳細に出す「お礼」セクション（issue #694）。
 * その相手から届いたお礼を新しい順に出し、「お礼を送る」で
 * 定型文＋1 行を送れる。送った分は取り消せる。
 * セクションを開いた（= 表示した）時点でその相手からの未読を既読にする。
 * フレンド以外には呼び出し側が出さない前提（API も送付を 404 にする）。
 */
export function FriendThanksSection({ uid }: { uid: string }) {
  const { t, i18n } = useTranslation();
  const { received, sent, isError } = useFriendThanksFor(uid);
  const send = useSendFriendThanks();
  const remove = useDeleteFriendThanks();
  const { mutate: markReceivedRead } = useMarkFriendThanksRead();
  const [composing, setComposing] = useState(false);

  const hasUnread = received.some((r) => r.readAt === null);
  useEffect(() => {
    // 「開いたら既読にする」。セクションが描画された時点でこの相手からの
    // 未読を既読にする（届いたお礼一覧を開いたときは画面側が全件既読）。
    // react-query の mutate は安定した参照なので deps に含めてよい。
    if (hasUnread) markReceivedRead(uid);
  }, [hasUnread, uid, markReceivedRead]);

  const alreadySentToday = sentTodayJst(sent);

  function onSubmit(presetKey: ThanksPresetKey, body: string | null) {
    send.mutate(
      { friendId: uid, presetKey, body },
      {
        onSuccess: () => setComposing(false),
        onError: (e) =>
          alert(
            t("お礼を送れませんでした"),
            e instanceof Error ? e.message : t("お礼の送信に失敗しました"),
            { okLabel: "OK" },
          ),
      },
    );
  }

  function confirmDelete(item: SentThanksItem) {
    confirm(
      t("お礼を取り消す"),
      t("送ったお礼を取り消しますか？"),
      () => {
        void remove
          .mutateAsync(item.id)
          .catch(() =>
            alert(
              t("お礼を取り消せませんでした"),
              t("お礼の取り消しに失敗しました"),
              { okLabel: "OK" },
            ),
          );
      },
      {
        confirmLabel: t("削除"),
        cancelLabel: t("キャンセル"),
        destructive: true,
      },
    );
  }

  if (isError) {
    return (
      <View className="mt-6 w-full self-start" testID="friend-thanks-section">
        <Text className="text-sm font-semibold text-secondary">
          {t("お礼")}
        </Text>
        <Text className="text-xs text-danger mt-1">
          {t("お礼の取得に失敗しました")}
        </Text>
      </View>
    );
  }

  return (
    <View className="mt-6 w-full self-start" testID="friend-thanks-section">
      <Text className="text-sm font-semibold text-secondary">{t("お礼")}</Text>
      {received.map((item) => (
        <ReceivedThanksRow key={item.id} item={item} language={i18n.language} />
      ))}
      {sent.map((item) => (
        <SentThanksRow
          key={item.id}
          item={item}
          language={i18n.language}
          onDelete={() => confirmDelete(item)}
        />
      ))}
      <TouchableOpacity
        className="mt-2 w-full rounded-lg bg-indigo-600 px-4 py-2.5 items-center"
        onPress={() => setComposing(true)}
        disabled={alreadySentToday}
        accessibilityRole="button"
        accessibilityLabel={t("お礼を送る")}
        testID="send-thanks-button"
        style={alreadySentToday ? { opacity: 0.5 } : undefined}
      >
        <Text className="text-white font-semibold">
          {alreadySentToday ? t("今日はもう送っています") : t("お礼を送る")}
        </Text>
      </TouchableOpacity>
      <FriendThanksSheet
        visible={composing}
        sending={send.isPending}
        onClose={() => setComposing(false)}
        onSubmit={onSubmit}
      />
    </View>
  );
}

function ReceivedThanksRow({
  item,
  language,
}: {
  item: ReceivedThanksItem;
  language: string;
}) {
  const { t } = useTranslation();
  return (
    <View
      className="mt-2 w-full rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-3"
      testID={`received-thanks-item-${item.id}`}
    >
      <Text className="text-xs text-muted">
        {t("届いたお礼")}・{formatThanksDate(item.createdAt, language)}
      </Text>
      <Text className="text-sm text-secondary mt-0.5">
        {t(THANKS_PRESET_TEXT[item.presetKey] ?? item.presetKey)}
      </Text>
      {item.body ? (
        <Text className="text-sm text-muted mt-0.5">{item.body}</Text>
      ) : null}
    </View>
  );
}

function SentThanksRow({
  item,
  language,
  onDelete,
}: {
  item: SentThanksItem;
  language: string;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View
      className="mt-2 w-full rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-3"
      testID={`sent-thanks-item-${item.id}`}
    >
      <Text className="text-xs text-muted">
        {t("送ったお礼")}・{formatThanksDate(item.createdAt, language)}
      </Text>
      <Text className="text-sm text-secondary mt-0.5">
        {t(THANKS_PRESET_TEXT[item.presetKey] ?? item.presetKey)}
      </Text>
      {item.body ? (
        <Text className="text-sm text-muted mt-0.5">{item.body}</Text>
      ) : null}
      <TouchableOpacity
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel={t("お礼を取り消す")}
        className="mt-2 self-start"
      >
        <Text className="text-xs text-danger">{t("削除")}</Text>
      </TouchableOpacity>
    </View>
  );
}
