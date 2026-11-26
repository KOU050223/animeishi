import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { MeishiRenderer } from "./meishi/MeishiRenderer";
import { resolveMeishiDocument } from "@/features/meishi/templates";
import type {
  MeishiDocument,
  MeishiRenderContext,
} from "@/features/meishi/types";
import { useMeishiRenderContext } from "@/features/meishi/useMeishiRenderContext";

export type MeishiCardProps = {
  username?: string | null | undefined;
  bio?: string | null | undefined;
  favoriteQuote?: string | null | undefined;
  profileImageUrl?: string | null | undefined;
  profileUrl?: string | null | undefined;
  document?: MeishiDocument | null | undefined;
  /** ピンチ&ズームを有効にするか。一覧のサムネイル等では false にする。 */
  zoomable?: boolean;
  profileOnly?: boolean;
  /**
   * bio・好きなセリフ・画像などバインド先が未設定の欄を、プレースホルダー
   * ではなく非表示にする。公開一覧用（issue #591）。既定は false で、
   * 自分のプロフィール画面のプレビューは従来どおりプレースホルダーを出す。
   */
  hideUnsetFields?: boolean;
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;

function clamp(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(Math.max(value, min), max);
}

/**
 * 名刺の表示用ラッパー。ピンチ&ズーム対応。
 * document が渡されればそれを、無ければ classic テンプレをフォールバックとしてレンダリングする。
 */
export function MeishiCard(props: MeishiCardProps) {
  if (props.profileOnly) return <ProfileOnlyMeishiCard {...props} />;
  return <FullMeishiCard {...props} />;
}

function ProfileOnlyMeishiCard(props: MeishiCardProps) {
  const context: MeishiRenderContext = {
    profile: {
      username: props.username,
      bio: props.bio,
      favoriteQuote: props.favoriteQuote,
      profileImageUrl: props.profileImageUrl,
      profileUrl: props.profileUrl,
    },
  };
  return <MeishiCardView {...props} context={context} />;
}

function FullMeishiCard(props: MeishiCardProps) {
  const context = useMeishiRenderContext({
    username: props.username,
    bio: props.bio,
    favoriteQuote: props.favoriteQuote,
    profileImageUrl: props.profileImageUrl,
    profileUrl: props.profileUrl,
  });
  return <MeishiCardView {...props} context={context} />;
}

function MeishiCardView({
  document,
  zoomable = false,
  hideUnsetFields = false,
  context,
}: MeishiCardProps & { context: MeishiRenderContext }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // 書き込みは .set() で行う（.value への代入は hook 戻り値の変更として
  // React Compiler 系 lint の react/immutability に引っかかる）。
  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.set(clamp(savedScale.value * e.scale, MIN_SCALE, MAX_SCALE));
    })
    .onEnd(() => {
      savedScale.set(scale.value);
      if (scale.value <= MIN_SCALE) {
        scale.set(withTiming(MIN_SCALE));
        translateX.set(withTiming(0));
        translateY.set(withTiming(0));
        savedTranslateX.set(0);
        savedTranslateY.set(0);
      }
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value <= MIN_SCALE) return;
      translateX.set(savedTranslateX.value + e.translationX);
      translateY.set(savedTranslateY.value + e.translationY);
    })
    .onEnd(() => {
      savedTranslateX.set(translateX.value);
      savedTranslateY.set(translateY.value);
    });

  const composed = Gesture.Simultaneous(pinch, pan);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const doc = resolveMeishiDocument(document);
  const renderContext: MeishiRenderContext = hideUnsetFields
    ? { ...context, hideUnsetFields }
    : context;

  const card = (
    <Animated.View
      style={[
        zoomable ? animatedStyle : undefined,
        {
          width: "100%",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.15)",
        },
      ]}
    >
      <MeishiRenderer document={doc} context={renderContext} />
    </Animated.View>
  );

  if (!zoomable) return card;

  return (
    <GestureDetector gesture={composed}>
      <View style={{ width: "100%", overflow: "hidden" }}>{card}</View>
    </GestureDetector>
  );
}
