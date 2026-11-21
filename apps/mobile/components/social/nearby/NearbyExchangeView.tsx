import { useCallback, useEffect, useRef, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MeishiCard } from "@/components/MeishiCard";
import {
  ExchangeResultLayer,
  type ExchangeResult,
} from "@/components/social/ExchangeResultLayer";
import { ApiRequestError } from "@/lib/apiError";
import { alert } from "@/lib/dialog";
import { enqueueExchange } from "@/lib/exchangeQueue";
import { haptics } from "@/lib/haptics";
import { useMeishiLibrary } from "@/lib/meishi/useMeishiLibrary";
import {
  approachProgress,
  proximityLevel,
  selectTargetPeer,
  useNearbyExchangeSession,
} from "@/lib/nearbyExchange";
import { parseQrPayload, type QrPayload } from "@/lib/qrParser";
import { useThemeColors } from "@/lib/theme";
import { useExchangeQrValue } from "@/lib/useExchangeQrValue";
import { useAddFriend } from "@/lib/useFriends";
import { useProfile } from "@/lib/useProfile";
import { NearbyExchangeStage, type StagePhase } from "./NearbyExchangeStage";
import { NearbyFallback } from "./NearbyFallback";

/** 「うまく交換できませんでした」を出しておく時間。 */
const FAILURE_NOTICE_MS = 4000;

type Registration =
  | { status: "pending" }
  | { status: "done"; result: ExchangeResult }
  | { status: "failed" };

/**
 * 「近づける」セグメント（issue #693）。iPhone の上の端どうしを近づけると
 * 名刺が入れ替わる（演出は D 案、docs/design/nearby-exchange）。
 * 受け取ったデータは QR を読み取ったときと同じ交換処理（対面トークン
 * qt / オフライン交換トークン ot、通信できなければ交換キュー）に流す。
 */
export function NearbyExchangeView({ onShowQr }: { onShowQr: () => void }) {
  const { t } = useTranslation();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const { data: profile } = useProfile();
  const { qrValue, shareUrl } = useExchangeQrValue();
  const { defaultCard } = useMeishiLibrary();
  const addFriend = useAddFriend();
  const displayName = profile?.username?.trim() || t("名もなきユーザー");

  const { state, finish, failureCount } = useNearbyExchangeSession({
    enabled: isFocused && qrValue != null,
    displayName,
    myPayload: qrValue,
  });

  const exchange = state.exchange;
  const swapping = exchange.kind === "swapping";
  const receivedRaw = swapping ? exchange.received : null;
  const [incoming, setIncoming] = useState<QrPayload | null>(null);
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [landed, setLanded] = useState(false);

  // 相手のデータが届いたら QR を読み取ったときと同じ検証・登録をする。
  // 演出（受け取り → 着地）は登録の応答を待たずに進める。
  const handledRaw = useRef<string | null>(null);
  useEffect(() => {
    if (receivedRaw == null || handledRaw.current === receivedRaw) return;
    handledRaw.current = receivedRaw;
    const payload = parseQrPayload(receivedRaw);
    if (!payload || (!payload.qrToken && !payload.offlineToken)) {
      alert(
        t("交換できませんでした"),
        t("相手のアプリを最新にしてから、もう一度近づけてください"),
        { okLabel: "OK", onClose: () => finish(false) },
      );
      return;
    }
    setIncoming(payload);
    setRegistration({ status: "pending" });
    const { userId, qrToken, offlineToken, miniMeishi } = payload;
    addFriend.mutate(
      { friendId: userId, qrToken, offlineToken },
      {
        onSuccess: (result) =>
          setRegistration({
            status: "done",
            result: {
              kind: "success",
              uid: userId,
              meetingCount: result.meetingCount,
              recordId: result.recordId,
            },
          }),
        onError: (e) => {
          if (!(e instanceof ApiRequestError)) {
            // 通信できない（電波の無い会場など）。QR と同じく交換キューへ積み、
            // 通信が戻ったら成立させる（issue #681）。
            void enqueueExchange({
              friendId: userId,
              qrToken,
              offlineToken,
              miniMeishi,
            })
              .then(() =>
                setRegistration({
                  status: "done",
                  result: { kind: "queued", uid: userId, miniMeishi },
                }),
              )
              .catch(() => setRegistration({ status: "failed" }));
            return;
          }
          setRegistration({ status: "failed" });
        },
      },
    );
    // addFriend は毎レンダー新しい参照になるため依存に入れない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receivedRaw, finish, t]);

  const resetExchange = useCallback(
    (exchanged: boolean) => {
      handledRaw.current = null;
      setIncoming(null);
      setRegistration(null);
      setLanded(false);
      finish(exchanged);
    },
    [finish],
  );

  const onLanded = useCallback(() => {
    haptics.success();
    setLanded(true);
  }, []);

  // 着地して登録も失敗していたら、知らせて探索に戻る。
  const registrationFailed = landed && registration?.status === "failed";
  useEffect(() => {
    if (!registrationFailed) return;
    alert(t("追加できませんでした"), t("フレンド追加に失敗しました"), {
      okLabel: "OK",
      onClose: () => resetExchange(false),
    });
  }, [registrationFailed, resetExchange, t]);

  // 相手のデータが届かずに入れ替わりが終わったら、しばらく案内を出す。
  const [dismissedFailureCount, setDismissedFailureCount] = useState(0);
  const showFailureNotice = failureCount > dismissedFailureCount;
  useEffect(() => {
    if (!showFailureNotice) return;
    const timer = setTimeout(
      () => setDismissedFailureCount(failureCount),
      FAILURE_NOTICE_MS,
    );
    return () => clearTimeout(timer);
  }, [showFailureNotice, failureCount]);
  const [prevSwapping, setPrevSwapping] = useState(swapping);
  if (prevSwapping !== swapping) {
    setPrevSwapping(swapping);
    // 入れ替わりが途中で消えた（タイムアウト・切断）ときは演出の状態も戻す。
    if (!swapping) {
      handledRaw.current = null;
      setIncoming(null);
      setRegistration(null);
      setLanded(false);
    }
  }

  if (qrValue == null || shareUrl == null) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-center text-slate-400 dark:text-slate-500">
          {t("QR コードを表示するにはサインインしてください")}
        </Text>
      </View>
    );
  }

  if (state.status !== "active") {
    return (
      <NearbyFallback
        reason={state.status}
        qrValue={qrValue}
        username={profile?.username ?? ""}
        onShowQr={onShowQr}
      />
    );
  }

  const target = selectTargetPeer(state);
  const phase: StagePhase = swapping ? "swap" : target ? "found" : "search";
  const peerName = swapping
    ? exchange.displayName || incoming?.miniMeishi?.username || ""
    : (target?.displayName ?? "");
  const progress = swapping ? 1 : approachProgress(target?.meters ?? null);

  let title: string;
  let subtitle: string;
  if (phase === "search") {
    title = t("近くの人を探しています");
    subtitle = t("相手にも「近づける」を開いてもらってください");
  } else if (phase === "found") {
    const level = proximityLevel(target?.meters ?? null);
    if (target?.meters == null) {
      title = t("{{name}}さんが見つかりました", { name: peerName });
      subtitle = t("iPhone の上の端どうしを近づけてください");
    } else if (level === "far") {
      title = t("もっと近づけて");
      subtitle = t("iPhone の上の端どうしを近づけてください");
    } else if (level === "near") {
      title = t("その調子");
      subtitle = t("上の端の光が強くなったら、あと少しです");
    } else {
      title = t("あと少し");
      subtitle = t("端どうしが触れるくらいまで");
    }
  } else if (landed) {
    title = t("交換成立");
    subtitle =
      registration?.status === "pending"
        ? t("登録しています…")
        : t("{{name}}さんの名刺を受け取りました", { name: peerName });
  } else if (incoming) {
    title = t("{{name}}さんの名刺が届きました", { name: peerName });
    subtitle = "";
  } else {
    title = t("あなたの名刺を {{name}}さんへ", { name: peerName });
    subtitle = t("上の端から相手の iPhone へ");
  }

  const result =
    landed && registration?.status === "done" ? registration.result : null;

  return (
    <View className="flex-1" testID="nearby-exchange-view">
      <NearbyExchangeStage
        phase={phase}
        progress={progress}
        received={incoming != null}
        peerName={peerName}
        peerAvatarUrl={incoming?.miniMeishi?.avatarUrl}
        onLanded={onLanded}
        myCard=<MeishiCard
          username={profile?.username}
          bio={profile?.bio}
          favoriteQuote={profile?.favoriteQuote}
          profileImageUrl={profile?.profileImageUrl}
          profileUrl={shareUrl}
          document={defaultCard?.document ?? null}
        />
      />
      <View
        pointerEvents="box-none"
        className="absolute left-6 right-6 items-center"
        style={{ bottom: insets.bottom + 72 }}
      >
        <Text
          className={`text-center text-[17px] font-bold ${
            landed
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-slate-900 dark:text-slate-100"
          }`}
          accessibilityLiveRegion="polite"
          testID="nearby-title"
        >
          {title}
        </Text>
        {subtitle ? (
          <Text className="mt-1.5 text-center text-[13px] leading-5 text-slate-500 dark:text-slate-400">
            {subtitle}
          </Text>
        ) : null}
        {showFailureNotice && phase !== "swap" ? (
          <Text
            className="mt-2 text-center text-xs text-red-600 dark:text-red-400"
            accessibilityRole="alert"
            testID="nearby-failure-notice"
          >
            {t("うまく交換できませんでした。もう一度近づけてください")}
          </Text>
        ) : null}
      </View>
      <TouchableOpacity
        className="absolute self-center flex-row items-center gap-1.5 py-2"
        style={{ bottom: insets.bottom + 24 }}
        onPress={onShowQr}
        disabled={swapping}
        accessibilityRole="button"
        testID="nearby-show-qr"
      >
        <Ionicons name="qr-code-outline" size={16} color={colors.primaryText} />
        <Text className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
          {t("QR で交換する")}
        </Text>
      </TouchableOpacity>
      {result ? (
        <ExchangeResultLayer
          key={`${result.kind}-${result.uid}`}
          result={result}
          onDone={() => resetExchange(true)}
          onShowMyQr={onShowQr}
        />
      ) : null}
    </View>
  );
}
