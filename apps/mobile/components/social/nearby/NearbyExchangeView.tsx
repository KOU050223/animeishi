import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
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
  selectTapPeers,
  selectTargetPeer,
  useNearbyExchangeSession,
} from "@/lib/nearbyExchange";
import { parseQrPayload, type QrPayload } from "@/lib/qrParser";
import { useExchangeQrValue } from "@/lib/useExchangeQrValue";
import { useAddFriend } from "@/lib/useFriends";
import { useProfile } from "@/lib/useProfile";
import { NearbyExchangeStage, type StagePhase } from "./NearbyExchangeStage";
import { NearbyFallback } from "./NearbyFallback";
import { nearbyHint } from "./nearbyHint";
import { NearbyRequestCard, NearbyTapList } from "./NearbyTapList";
import {
  NearbyHintPanel,
  NearbyNotices,
  ShowQrLink,
  TapModeBanner,
} from "./NearbyPanels";

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
  const { data: profile } = useProfile();
  const { qrValue, nearbyPayload, shareUrl } = useExchangeQrValue();
  const { defaultCard } = useMeishiLibrary();
  const displayName = profile?.username?.trim() || t("名もなきユーザー");

  const {
    state,
    finish,
    failureCount,
    requestExchange,
    cancelRequest,
    respond,
  } = useNearbyExchangeSession({
    enabled: isFocused && nearbyPayload != null,
    displayName,
    myPayload: nearbyPayload,
  });

  const exchange = state.exchange;
  const swapping = exchange.kind === "swapping";
  const receivedRaw = swapping ? exchange.received : null;
  // useRegisterIncoming 内の effect 依存に使うため参照を固定する。
  const incoming = useMemo(() => parseIncoming(receivedRaw), [receivedRaw]);
  const { registration, resetRegistration } = useRegisterIncoming({
    receivedRaw,
    incoming,
    onInvalid: () => finish(false),
  });
  const [landed, setLanded] = useState(false);

  // 登録失敗時の effect 依存に使うため参照を固定する。
  const resetExchange = useCallback(
    (exchanged: boolean) => {
      resetRegistration();
      setLanded(false);
      finish(exchanged);
    },
    [finish, resetRegistration],
  );

  const onLanded = () => {
    haptics.success();
    setLanded(true);
  };

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

  const showFailureNotice = useTimedNotice(failureCount);
  const showOutcomeNotice = useTimedNotice(state.lastOutcome?.id ?? 0);

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
  const tapPeers = selectTapPeers(state);
  const phase: StagePhase = swapping ? "swap" : target ? "found" : "search";
  const incomingPeer =
    state.request.kind === "incoming" && !swapping
      ? state.peers[state.request.peerId]
      : undefined;
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
    tapPeersOnly: tapPeers.length > 0,
  });
  const result =
    landed && registration?.status === "done" ? registration.result : null;

  return (
    <View className="flex-1" testID="nearby-exchange-view">
      {!state.selfUwb ? <TapModeBanner /> : null}
      <NearbyExchangeStage
        phase={phase}
        progress={swapping ? 1 : approachProgress(target?.meters ?? null)}
        received={incoming != null}
        peerName={peerName}
        onLanded={onLanded}
        compact={!swapping && tapPeers.length > 0}
        myCard=<MeishiCard
          username={profile?.username}
          bio={profile?.bio}
          favoriteQuote={profile?.favoriteQuote}
          profileImageUrl={profile?.profileImageUrl}
          profileUrl={shareUrl}
          document={defaultCard?.document ?? null}
        />
      />
      <NearbyHintPanel
        title={title}
        subtitle={subtitle}
        landed={landed}
        bottom={insets.bottom + 72}
      >
        {!swapping && tapPeers.length > 0 ? (
          <View className="mt-3 self-stretch">
            <NearbyTapList
              peers={tapPeers}
              request={state.request}
              disabled={swapping}
              onRequest={requestExchange}
              onCancel={cancelRequest}
            />
          </View>
        ) : null}
        <NearbyNotices
          outcome={showOutcomeNotice && !swapping ? state.lastOutcome : null}
          failed={showFailureNotice && !swapping}
        />
      </NearbyHintPanel>
      <ShowQrLink
        bottom={insets.bottom + 24}
        disabled={swapping}
        onPress={onShowQr}
      />
      {incomingPeer ? (
        <NearbyRequestCard
          name={incomingPeer.displayName}
          onAccept={() => respond(true)}
          onDecline={() => respond(false)}
        />
      ) : null}
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
  // 呼び出し側（NearbyExchangeView）の resetExchange/effect 依存に使うため
  // 参照を固定する。
  const resetRegistration = useCallback(() => setStored(null), []);
  return { registration, resetRegistration };
}

/**
 * 失敗・断られたなどの知らせをしばらく出す。key（増えていく番号）が
 * 変わるたびに一定時間 true を返す。
 */
function useTimedNotice(key: number): boolean {
  const [dismissedKey, setDismissedKey] = useState(0);
  const show = key > dismissedKey;
  useEffect(() => {
    if (!show) return;
    const timer = setTimeout(() => setDismissedKey(key), FAILURE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [show, key]);
  return show;
}
