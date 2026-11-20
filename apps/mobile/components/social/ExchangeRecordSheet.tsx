import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { initialWindowMetrics } from "react-native-safe-area-context";
import { Input } from "@/components/ui";
import { alert } from "@/lib/dialog";
import { useThemeColors } from "@/lib/theme";
import { useEventList } from "@/lib/useEvents";
import { resolvePlaceName } from "@/lib/exchangePlace";
import {
  rankEventCandidates,
  type RankedEventCandidate,
} from "@/lib/exchangeEventCandidates";
import type { ExchangeRecordUpdate } from "@/lib/useExchangeRecords";

export const EXCHANGE_PLACE_MAX_LENGTH = 100;
export const EXCHANGE_EVENT_MAX_LENGTH = 100;

/**
 * 交換記録の場所・イベント編集シート（issue #661）。
 * 交換直後の任意シートと、名刺帳の相手詳細からの後付け編集の両方で使う。
 *
 * - 「場所を残す」を押したときだけ位置権限を求め、座標は端末上で
 *   地名に変換して破棄する（resolvePlaceName がテキストだけを返す）。
 * - イベント候補は当日開催中の登録イベント。場所が取れていれば
 *   近いものを先に出し、自由入力も常時受け付ける。
 * - スキップ（何も残さず閉じる）は常にできる。
 */
export function ExchangeRecordSheet({
  visible,
  initialPlaceName,
  initialEventSlug,
  initialEventName,
  saving = false,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  initialPlaceName: string | null;
  initialEventSlug: string | null;
  initialEventName: string | null;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (update: ExchangeRecordUpdate) => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const events = useEventList();

  const [placeName, setPlaceName] = useState(initialPlaceName ?? "");
  const [eventSlug, setEventSlug] = useState(initialEventSlug);
  const [eventName, setEventName] = useState(initialEventName ?? "");
  const [resolvingPlace, setResolvingPlace] = useState(false);

  // シートが開くたび入力を最新の記録値に戻す（FriendNoteSheet と同じ
  // レンダー中リセットで effect の同期 setState を避ける）。
  const [prevSync, setPrevSync] = useState({
    visible,
    initialPlaceName,
    initialEventSlug,
    initialEventName,
  });
  if (
    prevSync.visible !== visible ||
    prevSync.initialPlaceName !== initialPlaceName ||
    prevSync.initialEventSlug !== initialEventSlug ||
    prevSync.initialEventName !== initialEventName
  ) {
    setPrevSync({
      visible,
      initialPlaceName,
      initialEventSlug,
      initialEventName,
    });
    if (visible) {
      setPlaceName(initialPlaceName ?? "");
      setEventSlug(initialEventSlug);
      setEventName(initialEventName ?? "");
    }
  }

  // 当日開催中の候補。場所が決まると近い順に並び替わる。
  // now はシートが開いた時点（= このコンポーネントのマウント）で固定する。
  const [now] = useState(() => new Date());
  const candidates: RankedEventCandidate[] = useMemo(
    () =>
      rankEventCandidates(events.data?.items ?? [], {
        now,
        placeName: placeName || null,
      }),
    [events.data, placeName, now],
  );

  async function onPressResolvePlace() {
    setResolvingPlace(true);
    try {
      const result = await resolvePlaceName();
      if (result.kind === "ok") {
        setPlaceName(result.name);
      } else if (result.kind === "denied") {
        alert(
          t("位置情報が許可されていません"),
          t("場所は手入力でも残せます"),
          { okLabel: "OK" },
        );
      } else {
        alert(t("場所を特定できませんでした"), t("場所は手入力でも残せます"), {
          okLabel: "OK",
        });
      }
    } finally {
      setResolvingPlace(false);
    }
  }

  function onPickEvent(candidate: RankedEventCandidate) {
    // 同じ候補を再度押すと選択解除（自由入力に戻る）
    if (eventSlug === candidate.slug) {
      setEventSlug(null);
      return;
    }
    setEventSlug(candidate.slug);
    setEventName("");
  }

  function onSubmitPressed() {
    const trimmedPlace = placeName.trim() || null;
    const trimmedEvent = eventName.trim() || null;
    // 登録イベントを選んだときは slug だけ送り、表示名は API が
    // events.title から写す。自由入力は eventName に入れる。
    onSubmit({
      placeName: trimmedPlace,
      eventSlug,
      eventName: eventSlug ? null : trimmedEvent,
    });
  }

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          onPress={onClose}
          style={{
            flex: 1,
            backgroundColor: colors.scrim,
            justifyContent: "flex-end",
            alignItems: "center",
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: 16,
              // Modal は全画面を覆うため下端はホームインジケータまで届く
              // （issue #462）。
              paddingBottom: 32 + (initialWindowMetrics?.insets.bottom ?? 0),
              width: "100%",
              maxWidth: 560,
            }}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: "bold",
                  marginBottom: 4,
                  color: colors.text,
                }}
              >
                {t("出会いを記録する")}
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  marginBottom: 12,
                  color: colors.textMuted,
                }}
              >
                {t("自分の名刺帳にだけ残る記録です")}
              </Text>

              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "600",
                  color: colors.text,
                  marginBottom: 6,
                }}
              >
                {t("場所")}
              </Text>
              <Input
                value={placeName}
                onChangeText={setPlaceName}
                maxLength={EXCHANGE_PLACE_MAX_LENGTH}
                placeholder={t("例: 東京ビッグサイト、駅前のカフェ")}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 16,
                  color: colors.text,
                }}
              />
              <Pressable
                onPress={onPressResolvePlace}
                disabled={resolvingPlace}
                accessibilityRole="button"
                accessibilityLabel={t("現在地から場所を残す")}
                accessibilityState={{ disabled: resolvingPlace }}
                style={{
                  marginTop: 8,
                  paddingVertical: 10,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: colors.border,
                  alignItems: "center",
                  flexDirection: "row",
                  justifyContent: "center",
                  gap: 8,
                  opacity: resolvingPlace ? 0.6 : 1,
                }}
              >
                {resolvingPlace ? (
                  <ActivityIndicator color={colors.primary} />
                ) : null}
                <Text style={{ fontWeight: "600", color: colors.text }}>
                  {t("場所を残す")}
                </Text>
              </Pressable>
              <Text
                style={{ fontSize: 11, marginTop: 4, color: colors.textMuted }}
              >
                {t("位置情報は地名に変換して端末上で破棄します")}
              </Text>

              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "600",
                  color: colors.text,
                  marginTop: 16,
                  marginBottom: 6,
                }}
              >
                {t("イベント")}
              </Text>
              {candidates.length > 0 ? (
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                >
                  {candidates.map((candidate) => {
                    const selected = eventSlug === candidate.slug;
                    return (
                      <Pressable
                        key={candidate.slug}
                        onPress={() => onPickEvent(candidate)}
                        accessibilityRole="button"
                        accessibilityLabel={candidate.title}
                        accessibilityState={{ selected }}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: selected
                            ? colors.primary
                            : colors.border,
                          backgroundColor: selected
                            ? colors.primary
                            : "transparent",
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 13,
                            color: selected ? colors.onPrimary : colors.text,
                          }}
                        >
                          {candidate.title}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              <Input
                value={eventName}
                onChangeText={(text) => {
                  setEventName(text);
                  // 自由入力に切り替えたら登録イベントの選択は外す
                  if (text) setEventSlug(null);
                }}
                maxLength={EXCHANGE_EVENT_MAX_LENGTH}
                placeholder={t("イベント名を入力")}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  padding: 12,
                  marginTop: 8,
                  fontSize: 16,
                  color: colors.text,
                }}
              />

              <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel={t("スキップ")}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 8,
                    backgroundColor: colors.surfaceMuted,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ fontWeight: "600", color: colors.text }}>
                    {t("スキップ")}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={onSubmitPressed}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel={t("保存")}
                  accessibilityState={{ disabled: saving }}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 8,
                    backgroundColor: colors.primary,
                    alignItems: "center",
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  <Text style={{ fontWeight: "600", color: colors.onPrimary }}>
                    {saving ? t("保存中…") : t("保存")}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
