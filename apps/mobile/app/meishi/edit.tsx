import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { EditorCanvas } from "@/components/meishi/EditorCanvas";
import { AddElementSheet } from "@/components/meishi/AddElementSheet";
import { PropertyPanel } from "@/components/meishi/PropertyPanel";
import { TemplatePicker } from "@/components/meishi/TemplatePicker";
import { TextEditSheet } from "@/components/meishi/TextEditSheet";
import { makeDefaultElement, newId } from "@/lib/meishi/defaults";
import { getTemplate, MEISHI_TEMPLATES } from "@/lib/meishi/templates";
import { useMeishiDocument } from "@/lib/meishi/useMeishiDocument";
import { buildProfileUrl } from "@/lib/profileUrl";
import { useProfile } from "@/lib/useProfile";
import type {
  MeishiElement,
  MeishiElementType,
  MeishiRenderContext,
} from "@/lib/meishi/types";

export default function MeishiEditScreen() {
  const router = useRouter();
  const { data: profile } = useProfile();
  const {
    doc,
    loaded,
    setDocFromTemplate,
    beginGesture,
    setElementTransformLive,
    updateElement,
    addElement,
    removeElement,
    duplicateElement,
    bringToFront,
    sendToBack,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useMeishiDocument();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addSheet, setAddSheet] = useState(false);
  const [textSheet, setTextSheet] = useState(false);
  const [templatePicker, setTemplatePicker] = useState(false);
  const [initialTemplateShown, setInitialTemplateShown] = useState(false);

  useEffect(() => {
    if (loaded && !doc && !initialTemplateShown) {
      setInitialTemplateShown(true);
      setTemplatePicker(true);
    }
  }, [loaded, doc, initialTemplateShown]);

  const context = useMemo<MeishiRenderContext>(
    () => ({
      profile: {
        username: profile?.username,
        bio: profile?.bio,
        favoriteQuote: profile?.favoriteQuote,
        profileImageUrl: profile?.profileImageUrl,
        profileUrl: buildProfileUrl(profile?.id),
      },
    }),
    [profile],
  );

  const selected = doc?.elements.find((e) => e.id === selectedId) ?? null;

  const onSelect = useCallback((id: string | null) => setSelectedId(id), []);

  // ジェスチャ由来の変形通知はここでは直接ライブ更新に流す。
  // beginGesture はキャンバス側で「操作開始した時点」を検出できないため、
  // 最初の onTransform が来たタイミングで beginGesture を呼ぶ。
  const gestureActiveRef = useMeishiGestureFlag();
  const onTransform = useCallback(
    (id: string, transform: MeishiElement["transform"]) => {
      if (!gestureActiveRef.current) {
        gestureActiveRef.current = true;
        beginGesture();
      }
      setElementTransformLive(id, transform);
    },
    [beginGesture, setElementTransformLive, gestureActiveRef],
  );
  const onCommit = useCallback(() => {
    gestureActiveRef.current = false;
  }, [gestureActiveRef]);

  if (!loaded) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  const handleTemplatePick = (id: string) => {
    const t = getTemplate(id);
    if (!t) return;
    setDocFromTemplate(t.build());
    setTemplatePicker(false);
    setSelectedId(null);
  };

  const handleAddElement = async (type: MeishiElementType) => {
    setAddSheet(false);
    if (type === "image") {
      try {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("写真へのアクセスが許可されていません");
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 0.8,
        });
        if (result.canceled || result.assets.length === 0) return;
        const base = makeDefaultElement("image");
        if (base.type === "image") {
          const newEl: MeishiElement = {
            ...base,
            uri: result.assets[0]!.uri,
            source: "upload",
          };
          addElement(newEl);
          setSelectedId(newEl.id);
        }
        return;
      } catch {
        Alert.alert("画像の追加に失敗しました");
        return;
      }
    }
    const el = makeDefaultElement(type);
    addElement(el);
    setSelectedId(el.id);
  };

  const handleAddAvatar = () => {
    setAddSheet(false);
    const base = makeDefaultElement("image");
    if (base.type !== "image") return;
    const el: MeishiElement = {
      ...base,
      source: "avatar",
      shape: "circle",
      uri: "",
    };
    addElement(el);
    setSelectedId(el.id);
  };

  const onSave = () => {
    Alert.alert(
      "保存しました",
      "名刺のドラフトを端末に保存しました。（サーバー送信は後続PRで実装）",
    );
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: "#ffffff" }}
      edges={["top", "left", "right"]}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="戻る"
        >
          <Text style={styles.headerBtnText}>‹ 戻る</Text>
        </Pressable>
        <Text style={styles.headerTitle}>名刺エディタ</Text>
        <View style={{ flexDirection: "row", gap: 4 }}>
          <Pressable
            onPress={undo}
            disabled={!canUndo}
            style={[styles.headerBtn, !canUndo && { opacity: 0.3 }]}
            accessibilityRole="button"
            accessibilityLabel="元に戻す"
          >
            <Text style={styles.headerBtnText}>↶</Text>
          </Pressable>
          <Pressable
            onPress={redo}
            disabled={!canRedo}
            style={[styles.headerBtn, !canRedo && { opacity: 0.3 }]}
            accessibilityRole="button"
            accessibilityLabel="やり直し"
          >
            <Text style={styles.headerBtnText}>↷</Text>
          </Pressable>
          <Pressable
            onPress={onSave}
            style={[styles.headerBtn, styles.saveBtn]}
            accessibilityRole="button"
            accessibilityLabel="保存"
          >
            <Text style={[styles.headerBtnText, { color: "#ffffff" }]}>
              保存
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.subHeader}>
        <Pressable
          onPress={() => setTemplatePicker(true)}
          style={styles.subBtn}
          accessibilityRole="button"
          accessibilityLabel="テンプレートを選ぶ"
        >
          <Text style={styles.subBtnText}>🎴 テンプレ</Text>
        </Pressable>
      </View>

      <View style={styles.canvasArea}>
        <View style={styles.canvasWrapper}>
          {doc ? (
            <EditorCanvas
              document={doc}
              context={context}
              selectedId={selectedId}
              onSelect={onSelect}
              onTransform={onTransform}
              onCommit={onCommit}
            />
          ) : (
            <View style={{ alignItems: "center", padding: 24 }}>
              <Text style={{ color: "#6b7280" }}>
                テンプレートを選んでください
              </Text>
            </View>
          )}
        </View>
      </View>

      {selected ? (
        <PropertyPanel
          element={selected}
          onChange={(patch) => updateElement(selected.id, patch)}
          onOpenTextEdit={() => setTextSheet(true)}
          onDelete={() => {
            removeElement(selected.id);
            setSelectedId(null);
          }}
          onDuplicate={() => {
            const nid = newId();
            duplicateElement(selected.id, nid);
            setSelectedId(nid);
          }}
          onBringToFront={() => bringToFront(selected.id)}
          onSendToBack={() => sendToBack(selected.id)}
        />
      ) : (
        <View style={styles.bottomBar}>
          <Pressable
            onPress={() => setAddSheet(true)}
            style={styles.addBtn}
            accessibilityRole="button"
            accessibilityLabel="要素を追加"
          >
            <Text style={styles.addBtnText}>＋ 要素を追加</Text>
          </Pressable>
        </View>
      )}

      <AddElementSheet
        visible={addSheet}
        onClose={() => setAddSheet(false)}
        onPick={handleAddElement}
        onPickAvatarImage={handleAddAvatar}
      />

      <TemplatePicker
        visible={templatePicker}
        onClose={() => {
          setTemplatePicker(false);
          if (!doc) {
            setDocFromTemplate(MEISHI_TEMPLATES[0].build());
          }
        }}
        onPick={handleTemplatePick}
        warningMessage={doc ? "現在の編集内容は上書きされます" : undefined}
      />

      {selected &&
      (selected.type === "text" ||
        (selected.type === "qr" && selected.source === "custom")) ? (
        <TextEditSheet
          visible={textSheet}
          initialValue={
            selected.type === "text" ? selected.text : selected.data
          }
          onClose={() => setTextSheet(false)}
          onSubmit={(value) => {
            if (selected.type === "text") {
              updateElement(selected.id, { text: value, source: "custom" });
            } else if (selected.type === "qr") {
              updateElement(selected.id, { data: value });
            }
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

function useMeishiGestureFlag() {
  // 一つのジェスチャシーケンス中は履歴を積まない。
  // useRef で保持し、初回変形時に立てる。onCommit で降ろす。
  return useRef(false);
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  canvasArea: {
    flex: 1,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e5e7eb",
  },
  canvasWrapper: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  headerTitle: { fontSize: 14, fontWeight: "600" },
  headerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  headerBtnText: { fontSize: 14, color: "#111827", fontWeight: "600" },
  saveBtn: { backgroundColor: "#4f46e5" },
  subHeader: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  subBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#f3f4f6",
  },
  subBtnText: { fontSize: 12, fontWeight: "600", color: "#111827" },
  bottomBar: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    backgroundColor: "#ffffff",
  },
  addBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#4f46e5",
    alignItems: "center",
  },
  addBtnText: { color: "#ffffff", fontWeight: "600", fontSize: 15 },
});
