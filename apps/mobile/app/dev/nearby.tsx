import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { BackButton } from "@/components/ui";
import { haptics } from "@/lib/haptics";
import {
  createProximityHaptics,
  nearbyExchange,
  proximityLevel,
  TOUCH_THRESHOLD_METERS,
} from "@/features/friends/nearbyExchange";
import type {
  DirectionVector,
  ProximityHaptics,
} from "@/features/friends/nearbyExchange";
import { useProfile } from "@/lib/useProfile";

type PeerView = {
  peerId: string;
  displayName: string;
  meters: number | null;
  direction?: DirectionVector | undefined;
  /** 一度でも touch 閾値以内に入ったら立つ。離れても表示を残す。 */
  exchanged: boolean;
};

// EXPO_PUBLIC_NEARBY_SPIKE=true のビルドでだけ入口が出る試作画面（issue #698）。
// 発見・接続は Network framework、距離は Nearby Interaction（UWB）で測る。
// 実際のフレンド登録は行わない。
export default function NearbySpikeScreen() {
  const spikeEnabled = process.env.EXPO_PUBLIC_NEARBY_SPIKE === "true";
  const { t } = useTranslation();
  const router = useRouter();
  const { data: profile } = useProfile();
  const displayName = profile?.username?.trim() || t("名もなきユーザー");
  const [peers, setPeers] = useState<Record<string, PeerView>>({});
  const [uwb, setUwb] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hapticsByPeer = useRef(new Map<string, ProximityHaptics>());

  useEffect(() => {
    if (!spikeEnabled) return;

    const subscriptions = [
      nearbyExchange.addListener(
        "onPeerFound",
        ({ peerId, displayName: peerName }) => {
          setPeers((prev) => ({
            ...prev,
            [peerId]: {
              peerId,
              displayName: peerName,
              meters: null,
              exchanged: false,
            },
          }));
        },
      ),
      nearbyExchange.addListener("onPeerLost", ({ peerId }) => {
        hapticsByPeer.current.delete(peerId);
        setPeers((prev) => {
          const next = { ...prev };
          delete next[peerId];
          return next;
        });
      }),
      nearbyExchange.addListener(
        "onDistance",
        ({ peerId, meters, direction }) => {
          const decider =
            hapticsByPeer.current.get(peerId) ?? createProximityHaptics();
          hapticsByPeer.current.set(peerId, decider);
          switch (decider.next(meters, Date.now())) {
            case "light":
              haptics.impactLight();
              break;
            case "medium":
              haptics.impactMedium();
              break;
            case "strong":
              haptics.impactHeavy();
              break;
            case "none":
              break;
          }
          setPeers((prev) => {
            const peer = prev[peerId];
            if (!peer) return prev;
            return {
              ...prev,
              [peerId]: {
                ...peer,
                meters,
                direction,
                exchanged: peer.exchanged || proximityLevel(meters) === "touch",
              },
            };
          });
        },
      ),
      nearbyExchange.addListener("onError", ({ code, message }) => {
        if (code === "unsupported_platform") {
          setErrorMessage(t("この端末では近づけて交換は利用できません"));
          return;
        }
        setErrorMessage(`${code}: ${message}`);
      }),
      nearbyExchange.addListener("onCapability", ({ uwb: supported }) => {
        setUwb(supported);
      }),
    ];
    nearbyExchange.start({ displayName });
    return () => {
      subscriptions.forEach((s) => s.remove());
      hapticsByPeer.current.clear();
      nearbyExchange.stop();
    };
  }, [displayName, spikeEnabled, t]);

  if (!spikeEnabled) {
    return <Redirect href="/" />;
  }

  // 直リンクでは遷移履歴が無いため、ホームへ戻す（changelog と同じ規約）。
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  };

  const peerList = Object.values(peers);

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["bottom"]}
    >
      <Stack.Screen
        options={{
          title: t("近づけて交換（試作）"),
          headerBackVisible: false,
          headerLeft: () => (
            <BackButton
              onPress={handleBack}
              accessibilityLabel={t("戻る")}
              testID="dev-nearby-back-button"
            />
          ),
        }}
      />
      <ScrollView className="flex-1">
        <View className="w-full max-w-2xl self-center px-6 pb-16 pt-4">
          <Text className="text-sm text-muted">
            {t("自分の名前:")} {displayName}
          </Text>
          <Text className="mt-1 text-sm text-muted">
            UWB:{" "}
            {uwb == null
              ? t("確認中…")
              : uwb
                ? t("対応")
                : t("非対応（発見・接続のみ動作）")}
          </Text>

          {errorMessage ? (
            <View className="mt-3 rounded-lg bg-red-50 px-4 py-3 dark:bg-red-950">
              <Text
                className="text-sm font-medium text-danger"
                accessibilityRole="alert"
              >
                {errorMessage}
              </Text>
            </View>
          ) : null}

          {peerList.length === 0 ? (
            <Text className="mt-10 text-center text-base text-muted">
              {t("近くの相手を探しています…")}
            </Text>
          ) : (
            <View className="mt-6 gap-4">
              {peerList.map((peer) => (
                <View
                  key={peer.peerId}
                  className="rounded-2xl border border-slate-200 px-5 py-4 dark:border-slate-700"
                >
                  <View className="flex-row items-center justify-between">
                    <Text className="text-lg font-semibold text-foreground">
                      {peer.displayName || peer.peerId.slice(0, 8)}
                    </Text>
                    {peer.exchanged ? (
                      <Text className="rounded-full bg-green-100 px-3 py-1 text-sm font-bold text-success dark:bg-green-900">
                        {t("成立")}
                      </Text>
                    ) : null}
                  </View>
                  <View className="mt-2 flex-row items-end justify-center">
                    {peer.meters != null ? (
                      <>
                        <Text className="text-6xl font-bold text-foreground">
                          {Math.max(0, Math.round(peer.meters * 100))}
                        </Text>
                        <Text className="mb-2 ml-1 text-xl text-muted">cm</Text>
                      </>
                    ) : (
                      <Text className="py-4 text-3xl text-muted">
                        {uwb === false ? t("UWB 非対応") : "---"}
                      </Text>
                    )}
                  </View>
                  <Text className="mt-1 text-center text-xs text-muted">
                    {peer.direction
                      ? t("方向を検出中")
                      : peer.meters != null
                        ? t("方向は未検出")
                        : t("10cm 以内に近づけると成立します")}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <Text className="mt-8 text-xs text-muted">
            {t(
              "相手まで {{cm}}cm 以内で成立（試作）。フレンド登録は行いません。",
              {
                cm: Math.round(TOUCH_THRESHOLD_METERS * 100),
              },
            )}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
