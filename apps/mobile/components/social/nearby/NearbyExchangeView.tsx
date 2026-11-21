import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { nearbyHint } from "./nearbyHint";

/** 「うまく交換できませんでした」を出しておく時間。 */
const FAILURE_NOTICE_MS = 4000;

type Registration =
  | { raw: string; status: "done"; result: ExchangeResult }
  | { raw: string; status: "failed" };

/** 届いたデータが交換に使えるか（QR を読み取ったときと同じ条件）。 */
function parseIncoming(raw: string | null): QrPayload | null {
  if (raw == null) return null;
  const payload = parseQrPayload(raw);
  if (!payload || (!payload.qrToken && !payload.offlineToken)) return null;
  return payload;
}

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
  const { qrValue, nearbyPayload, shareUrl } = useExchangeQrValue();
  const { defaultCard } = useMeishiLibrary();
  const displayName = profile?.username?.trim() || t("名もなきユーザー");

  const { state, finish, failureCount } = useNearbyExchangeSession({
    enabled: isFocused && nearbyPayload != null,
    displayName,
    myPayload: nearbyPayload,
  });

  const exchange = state.exchange;
  const swapping = exchange.kind === "swapping";
  const receivedRaw = swapping ? exchange.received : null;
  const incoming = useMemo(() => parseIncoming(receivedRaw), [receivedRaw]);
  const { registration, resetRegistration } = useRegisterIncoming({
    receivedRaw,
    incoming,
    onInvalid: () => finish(false),
  });
  const [landed, setLanded] = useState(false);

  const resetExchange = useCallback(
    (exchanged: boolean) => {
      resetRegistration();
      setLanded(false);
      finish(exchanged);
    },
    [finish, resetRegistration],
  );

  const onLanded = useCallback(() => {
    haptics.success();
    setLanded(true);
  }, []);

  // 入れ替わりが途中で消えた（タイムアウト・切断）ときは演出の状態も戻す。
  const [prevSwapping, setPrevSwapping] = useState(swapping);
  if (prevSwapping !== swapping) {
    setPrevSwapping(swapping);
    if (!swapping) setLanded(false);
  }

  // 着地して登録も失敗していたら、知らせて探索に戻る。
  const registrationFailed = landed && registration?.status === "failed";
  useEffect(() => {
    if (!registrationFailed) return;
    alert(t("追加できませんでした"), t("フレンド追加に失敗しました"), {
      okLabel: "OK",
      onClose: () => resetExchange(false),
    });
  }, [registrationFailed, resetExchange, t]);

  const showFailureNotice = useFailureNotice(failureCount);

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
  const { title, subtitle } = nearbyHint(t, {
    phase,
    peerName,
    meters: target?.meters ?? null,
    received: incoming != null,
    landed,
    registering: registration == null,
  });
  const result =
    landed && registration?.status === "done" ? registration.result : null;

  return (
    <View className="flex-1" testID="nearby-exchange-view">
      <NearbyExchangeStage
        phase={phase}
        progress={swapping ? 1 : approachProgress(target?.meters ?? null)}
        received={incoming != null}
        peerName={peerName}
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

/**
 * 相手のデータが届いたら QR を読み取ったときと同じ登録をする。
 * 演出（受け取り → 着地）は登録の応答を待たずに進めるため、結果は
 * 届いたデータ（raw）ごとに持ち、現在のデータの結果だけを返す。
 */
function useRegisterIncoming({
  receivedRaw,
  incoming,
  onInvalid,
}: {
  receivedRaw: string | null;
  incoming: QrPayload | null;
  onInvalid: () => void;
}) {
  const { t } = useTranslation();
  const addFriend = useAddFriend();
  const [stored, setStored] = useState<Registration | null>(null);
  const handledRaw = useRef<string | null>(null);

  useEffect(() => {
    if (receivedRaw == null) {
      handledRaw.current = null;
      return;
    }
    if (handledRaw.current === receivedRaw) return;
    handledRaw.current = receivedRaw;
    if (!incoming) {
      alert(
        t("交換できませんでした"),
        t("相手のアプリを最新にしてから、もう一度近づけてください"),
        { okLabel: "OK", onClose: onInvalid },
      );
      return;
    }
    const raw = receivedRaw;
    const { userId, qrToken, offlineToken, miniMeishi } = incoming;
    addFriend.mutate(
      { friendId: userId, qrToken, offlineToken },
      {
        onSuccess: (result) =>
          setStored({
            raw,
            status: "done",
            result: {
              kind: "success",
              uid: userId,
              meetingCount: result.meetingCount,
              recordId: result.recordId,
            },
          }),
        onError: (e) => {
          if (e instanceof ApiRequestError) {
            setStored({ raw, status: "failed" });
            return;
          }
          // 通信できない（電波の無い会場など）。QR と同じく交換キューへ積み、
          // 通信が戻ったら成立させる（issue #681）。
          void enqueueExchange({
            friendId: userId,
            qrToken,
            offlineToken,
            miniMeishi,
          })
            .then(() =>
              setStored({
                raw,
                status: "done",
                result: { kind: "queued", uid: userId, miniMeishi },
              }),
            )
            .catch(() => setStored({ raw, status: "failed" }));
        },
      },
    );
    // addFriend・onInvalid は毎レンダー新しい参照になるため依存に入れない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receivedRaw, incoming, t]);

  const registration =
    stored != null && stored.raw === receivedRaw ? stored : null;
  const resetRegistration = useCallback(() => setStored(null), []);
  return { registration, resetRegistration };
}

/** 相手のデータが届かずに入れ替わりが終わったら、しばらく案内を出す。 */
function useFailureNotice(failureCount: number): boolean {
  const [dismissedFailureCount, setDismissedFailureCount] = useState(0);
  const show = failureCount > dismissedFailureCount;
  useEffect(() => {
    if (!show) return;
    const timer = setTimeout(
      () => setDismissedFailureCount(failureCount),
      FAILURE_NOTICE_MS,
    );
    return () => clearTimeout(timer);
  }, [show, failureCount]);
  return show;
}
