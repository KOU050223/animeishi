import { useState } from "react";
import {
  Modal,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useTranslation } from "react-i18next";
import { MeishiCard, type MeishiCardProps } from "@/components/MeishiCard";
import { resolveMeishiDocument } from "@/lib/meishi/templates";

export function ProfileMeishiPreview(props: MeishiCardProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const { width, height } = useWindowDimensions();
  const aspectRatio = resolveMeishiDocument(props.document).canvas.aspectRatio;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("名刺を拡大")}
        onPress={() => setIsOpen(true)}
        style={{ cursor: "zoom-in" }}
      >
        <MeishiCard {...props} />
      </Pressable>
      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
      >
        <View
          testID="profile-meishi-zoom-dialog"
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0, 0, 0, 0.85)",
          }}
        >
          <Pressable
            onPress={() => setIsOpen(false)}
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
            }}
            accessibilityRole="button"
            accessibilityLabel={t("名刺を閉じる")}
          />
          <View
            style={{
              width: Math.min(width - 32, (height - 100) * aspectRatio, 840),
            }}
          >
            <MeishiCard {...props} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("名刺を閉じる")}
              onPress={() => setIsOpen(false)}
              className="mt-4 self-center rounded-lg bg-surface px-5 py-2"
            >
              <Text className="font-semibold text-foreground">
                {t("閉じる")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}
