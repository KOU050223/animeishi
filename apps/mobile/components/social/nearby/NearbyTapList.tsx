import { FlatList, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { NearbyPeer, NearbyTapRequest } from "@/lib/nearbyExchange";

/**
 * タップで交換する相手の一覧（issue #693、どちらかが UWB 非対応のとき）。
 * 相手をタップすると交換を申し込み、返事を待つ間は取り消せる。
 */
export function NearbyTapList({
  peers,
  request,
  disabled,
  onRequest,
  onCancel,
}: {
  peers: NearbyPeer[];
  request: NearbyTapRequest;
  /** 入れ替わり中など、新しく申し込めない間は true。 */
  disabled: boolean;
  onRequest: (peerId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View
      className="self-stretch rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/95"
      testID="nearby-tap-list"
    >
      <Text className="px-1 pb-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
        {t("近くにいる人")}
      </Text>
      <FlatList
        style={{ maxHeight: 152 }}
        data={peers}
        keyExtractor={(peer) => peer.peerId}
        renderItem={({ item: peer }) => {
          const waiting =
            request.kind === "outgoing" && request.peerId === peer.peerId;
          const busy = request.kind !== "none" || disabled;
          return (
            <View
              className="flex-row items-center gap-3 py-1.5"
              testID={`nearby-tap-peer-${peer.peerId}`}
            >
              <View className="h-9 w-9 items-center justify-center rounded-full bg-indigo-500">
                <Text className="text-sm font-bold text-white">
                  {peer.displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View className="min-w-0 flex-1">
                <Text
                  numberOfLines={1}
                  className="text-[15px] font-semibold text-slate-900 dark:text-slate-100"
                >
                  {peer.displayName}
                </Text>
                {waiting ? (
                  <Text className="text-xs text-slate-500 dark:text-slate-400">
                    {t("返事を待っています…")}
                  </Text>
                ) : null}
              </View>
              {waiting ? (
                <TouchableOpacity
                  className="rounded-full bg-slate-100 px-3.5 py-1.5 dark:bg-slate-700"
                  onPress={onCancel}
                  accessibilityRole="button"
                  accessibilityLabel={t("{{name}}さんへの申し込みを取り消す", {
                    name: peer.displayName,
                  })}
                  testID={`nearby-tap-cancel-${peer.peerId}`}
                >
                  <Text className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                    {t("取り消す")}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  className={`rounded-full px-3.5 py-1.5 ${
                    busy ? "bg-slate-100 dark:bg-slate-700" : "bg-indigo-600"
                  }`}
                  onPress={() => onRequest(peer.peerId)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={t("{{name}}さんに交換を申し込む", {
                    name: peer.displayName,
                  })}
                  accessibilityState={{ disabled: busy }}
                  testID={`nearby-tap-request-${peer.peerId}`}
                >
                  <Text
                    className={`text-[13px] font-semibold ${
                      busy ? "text-slate-400 dark:text-slate-500" : "text-white"
                    }`}
                  >
                    {t("交換する")}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

/**
 * 相手から交換を申し込まれたときの確認。OS のダイアログではなく画面内の
 * カードにするのは、相手が取り下げた・いなくなったときに閉じられるようにするため。
 */
export function NearbyRequestCard({
  name,
  onAccept,
  onDecline,
}: {
  name: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View
      className="absolute inset-0 items-center justify-center bg-black/40 px-6"
      testID="nearby-request-card"
    >
      <View
        className="w-full max-w-sm items-center rounded-3xl bg-white px-6 pb-5 pt-6 dark:bg-slate-800"
        accessibilityViewIsModal
      >
        <View className="h-14 w-14 items-center justify-center rounded-full bg-indigo-500">
          <Text className="text-xl font-bold text-white">
            {name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text
          className="mt-3 text-center text-[17px] font-bold text-slate-900 dark:text-slate-100"
          accessibilityRole="header"
        >
          {t("{{name}}さんと名刺を交換しますか？", { name })}
        </Text>
        <Text className="mt-1.5 text-center text-[13px] leading-5 text-slate-500 dark:text-slate-400">
          {t("交換すると、お互いの名刺が相手に届きます")}
        </Text>
        <TouchableOpacity
          className="mt-5 items-center self-stretch rounded-lg bg-indigo-600 py-3"
          onPress={onAccept}
          accessibilityRole="button"
          testID="nearby-request-accept"
        >
          <Text className="font-semibold text-white">{t("交換する")}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="mt-2 items-center self-stretch rounded-lg py-3"
          onPress={onDecline}
          accessibilityRole="button"
          testID="nearby-request-decline"
        >
          <Text className="font-semibold text-slate-600 dark:text-slate-300">
            {t("やめておく")}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
