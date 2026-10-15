import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Input } from "@/components/ui";
import { pickImageUrl } from "@/lib/anime/pickImageUrl";
import { useWorkSearch } from "@/lib/tierList/useWorkSearch";
import type { TierWork } from "@/lib/tierList/types";
import { formatYearSeason } from "@/components/anime-list/animeListUtils";

/**
 * 未分類トレイへ作品を追加するための検索シート（issue #168）。
 * シーズン候補に載らない作品を Annict のタイトル検索で見つけて追加する。
 * 追加した作品は未分類トレイの末尾に置かれ、そこから各 tier へドラッグできる。
 * 複数まとめて追加できるよう、追加してもシートは閉じない。
 */
export function WorkAddSheet({
  visible,
  onClose,
  onAdd,
  existingWorkIds,
}: {
  visible: boolean;
  onClose: () => void;
  /** 検索結果の作品が選ばれたとき。追加済みかの判定は呼び出し側が持つ。 */
  onAdd: (work: TierWork) => void;
  /** 既に盤面にある作品 id。検索結果で「追加済み」表示にして二重追加を防ぐ。 */
  existingWorkIds: ReadonlySet<number>;
}) {
  const [query, setQuery] = useState("");
  // 開くたびに新しい検索として始める（前回の語・結果を引きずらない）。
  useEffect(() => {
    if (visible) setQuery("");
  }, [visible]);

  // シートは Modal 内で常時マウントされるため、閉じている間は enabled で
  // 検索を無効化する（デバウンス済みの旧語で再フェッチが走らないように）。
  const {
    works,
    hasQuery,
    hasMore,
    isFetching,
    isError,
    resultsStale,
    refetch,
  } = useWorkSearch(query, visible);

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
            backgroundColor: "rgba(0,0,0,0.4)",
            justifyContent: "flex-end",
            alignItems: "center",
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: "#ffffff",
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: 16,
              paddingBottom: 32,
              width: "100%",
              maxWidth: 560,
              // 結果一覧をスクロールできるよう高さを確保する
              // （内容量まかせだと FlatList が伸びきって下端が見えなくなる）。
              height: "72%",
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: "bold", marginBottom: 4 }}>
              作品を追加
            </Text>
            <Text style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
              シーズンの候補にない作品をタイトルで検索して未分類に追加できます。
              保存対象は tier に配置した作品です
            </Text>
            <Input
              value={query}
              onChangeText={setQuery}
              autoFocus
              placeholder="タイトル・よみがな・英語名で検索"
              returnKeyType="search"
              testID="work-add-input"
              style={{
                borderWidth: 1,
                borderColor: "#e5e7eb",
                borderRadius: 8,
                padding: 12,
                fontSize: 16,
              }}
            />
            <View style={{ flex: 1, marginTop: 8 }}>
              {!hasQuery ? (
                <Text
                  style={{
                    color: "#6b7280",
                    fontSize: 13,
                    textAlign: "center",
                    marginTop: 24,
                  }}
                >
                  追加する作品のタイトルを入力してください
                </Text>
              ) : works.length === 0 && (isFetching || resultsStale) ? (
                <View style={{ alignItems: "center", marginTop: 24, gap: 8 }}>
                  <ActivityIndicator color="#9ca3af" />
                  <Text style={{ color: "#6b7280", fontSize: 13 }}>
                    検索しています
                  </Text>
                </View>
              ) : isError ? (
                <View style={{ alignItems: "center", marginTop: 24, gap: 8 }}>
                  <Text style={{ color: "#b42318", fontSize: 13 }}>
                    検索に失敗しました
                  </Text>
                  <TouchableOpacity
                    onPress={() => refetch()}
                    accessibilityRole="button"
                    accessibilityLabel="作品検索を再試行"
                    testID="work-add-retry"
                    style={{
                      backgroundColor: "#4f46e5",
                      borderRadius: 8,
                      paddingHorizontal: 16,
                      paddingVertical: 8,
                    }}
                  >
                    <Text style={{ color: "#ffffff", fontWeight: "600" }}>
                      再試行
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : works.length === 0 ? (
                <Text
                  style={{
                    color: "#6b7280",
                    fontSize: 13,
                    textAlign: "center",
                    marginTop: 24,
                  }}
                >
                  見つかりませんでした
                </Text>
              ) : (
                <FlatList
                  data={works}
                  keyExtractor={(item) => String(item.annictWorkId)}
                  keyboardShouldPersistTaps="handled"
                  ListFooterComponent={
                    // タイトル検索は先頭ページのみ取得するため、末尾に
                    // さらなる絞り込みを促す。
                    hasMore ? (
                      <Text
                        style={{
                          color: "#6b7280",
                          fontSize: 12,
                          textAlign: "center",
                          paddingVertical: 12,
                        }}
                      >
                        上位の結果のみを表示しています。タイトルを絞り込んでください
                      </Text>
                    ) : null
                  }
                  renderItem={({ item }) => {
                    const added = existingWorkIds.has(item.annictWorkId);
                    // 検索語を変えた直後は前の語の結果を仮表示している
                    // （デバウンス待ち / keepPreviousData）。その一覧は
                    // 新しい語の結果ではないので、入れ替わるまで追加操作を
                    // 受け付けない。
                    const disabled = added || resultsStale;
                    const uri = pickImageUrl(item);
                    const seasonText = formatYearSeason(
                      item.seasonYear,
                      item.seasonName?.includes("-")
                        ? item.seasonName.split("-")[1]
                        : item.seasonName,
                    );
                    return (
                      <TouchableOpacity
                        onPress={() =>
                          onAdd({
                            annictWorkId: item.annictWorkId,
                            title: item.title,
                            imageUrl: item.imageUrl,
                            resolvedImageUrl: item.resolvedImageUrl,
                          })
                        }
                        disabled={disabled}
                        accessibilityRole="button"
                        accessibilityLabel={`${item.title}を追加`}
                        accessibilityState={{ disabled }}
                        testID={`work-add-item-${item.annictWorkId}`}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 10,
                          paddingVertical: 8,
                          borderBottomWidth: 1,
                          borderBottomColor: "#f3f4f6",
                          opacity: disabled ? 0.5 : 1,
                        }}
                      >
                        {uri ? (
                          <Image
                            source={{ uri }}
                            style={{
                              width: 36,
                              height: 50,
                              borderRadius: 4,
                              backgroundColor: "#e5e7eb",
                            }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View
                            style={{
                              width: 36,
                              height: 50,
                              borderRadius: 4,
                              backgroundColor: "#e5e7eb",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Text style={{ fontSize: 14 }}>🎬</Text>
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{ fontSize: 14, color: "#111827" }}
                            numberOfLines={2}
                          >
                            {item.title}
                          </Text>
                          {seasonText ? (
                            <Text style={{ fontSize: 11, color: "#6b7280" }}>
                              {seasonText}
                            </Text>
                          ) : null}
                        </View>
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "600",
                            color: added ? "#6b7280" : "#4f46e5",
                          }}
                        >
                          {added ? "追加済み" : "追加"}
                        </Text>
                      </TouchableOpacity>
                    );
                  }}
                />
              )}
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="閉じる"
              testID="work-add-close"
              style={{
                marginTop: 12,
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: "#e5e7eb",
                alignItems: "center",
              }}
            >
              <Text style={{ fontWeight: "600", color: "#111827" }}>
                閉じる
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
