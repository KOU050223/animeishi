import { useEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";

// 作品画像の表示に共通で使う expo-image のラッパー（issue #222 / #224）。
// RN 標準の <Image> はディスクキャッシュが弱く、一覧を行き来するたびに
// 画像プロキシへ取りに行くため expo-image に寄せる。
//
// 表示する URL は 1 本だけ（作品なら画像プロキシの hostedImageUrl）。
// プロキシは Annict / Kitsu / MAL の候補を取り込んで配信するので、
// 読み込みに失敗した作品は外部 URL に切り替えても表示できない。
// そのため失敗したらすぐ placeholder に切り替える。
// 読み込み中も同じ placeholder を下に敷き、画像が上にフェードインする。

/** 一覧に出す画像のフェードイン時間（ms）。 */
const DEFAULT_TRANSITION_MS = 200;

/**
 * 読み込み失敗時の再試行間隔（ms）。要素数が再試行回数。
 * プロキシは初回リクエストで外部からの取り込みを待つことがあり、
 * その待ちでタイムアウト・5xx・edge 側の一時的な 404 を踏むと、
 * リトライなしではその画面ではずっと placeholder のままになる
 * （issue #522 で観測された全面「No img」の再現経路）。
 * 本当に画像が無い作品でも数回は叩くが、プロキシ側の 404 は
 * MISS_CACHE_CONTROL でキャッシュされるため再試行は edge で完結する。
 */
const RETRY_DELAYS_MS = [1500, 4000];

/**
 * 失敗レスポンスが HTTP キャッシュ（ブラウザ / expo-image / CF edge）に
 * 残っていると、同じ URL の再試行はキャッシュされた失敗を即座に返す。
 * 試行ごとにキーを変えて必ずオリジンへ行かせる。
 */
function retryUri(uri: string, attempt: number): string {
  if (attempt === 0) return uri;
  const sep = uri.includes("?") ? "&" : "?";
  return `${uri}${sep}r=${attempt}`;
}

export function WorkImage({
  uri,
  style,
  placeholder,
  accessibilityLabel,
  transition = DEFAULT_TRANSITION_MS,
  onLoadEnd,
}: {
  uri: string | null | undefined;
  /** 画像の枠（幅・高さ・角丸など）。placeholder は同じ大きさで描く前提。 */
  style: StyleProp<ViewStyle>;
  /** URL が無い・読み込み中・読み込み失敗のときに見せる要素。 */
  placeholder: ReactNode;
  accessibilityLabel?: string;
  /** フェードイン時間（ms）。0 で即時表示。 */
  transition?: number;
  /** 読み込みの成功・失敗どちらでも呼ばれる。 */
  onLoadEnd?: () => void;
}) {
  // 失敗フラグは表示中の URL と組で持ち、URL が変わったら下ろす
  // （A → B → A と戻ったときも A を読み込み直す）。レンダー中の setState は
  // 同じレンダー内で反映される公式の派生 state リセットパターン。
  const [state, setState] = useState({
    uri,
    attempt: 0,
    waiting: false,
    failed: false,
  });
  if (state.uri !== uri) {
    setState({ uri, attempt: 0, waiting: false, failed: false });
  }
  const current =
    state.uri === uri
      ? state
      : { uri, attempt: 0, waiting: false, failed: false };

  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  if (!uri || current.failed) return <>{placeholder}</>;

  const onError = () => {
    if (current.attempt >= RETRY_DELAYS_MS.length) {
      setState({ uri, attempt: current.attempt, waiting: false, failed: true });
      return;
    }
    // 待機中は壊れた img 要素を画面に残さない（web で alt+破損アイコンが
    // 出るのを防ぐ）ため、タイマー発火までは placeholder だけにする。
    const failingUri = uri;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => {
      setState((s) =>
        s.uri === failingUri
          ? {
              uri: failingUri,
              attempt: s.attempt + 1,
              waiting: false,
              failed: false,
            }
          : s,
      );
    }, RETRY_DELAYS_MS[current.attempt]);
    setState({
      uri: failingUri,
      attempt: current.attempt,
      waiting: true,
      failed: false,
    });
  };

  return (
    <View style={[style, styles.frame]}>
      <View style={StyleSheet.absoluteFill}>{placeholder}</View>
      {current.waiting ? null : (
        <Image
          source={{ uri: retryUri(uri, current.attempt) }}
          style={StyleSheet.absoluteFill}
          // web での既定値 draggable=true のままだと、画像を含むカードの
          // ドラッグ操作にブラウザのネイティブドラッグが割り込み pointercancel で
          // ジェスチャが死ぬ（issue #327）。RN の Image（draggable=false 既定）と
          // 同じ扱いにするため明示的に無効化する。
          draggable={false}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={transition}
          onError={onError}
          onLoadEnd={onLoadEnd}
          accessibilityLabel={accessibilityLabel}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // 角丸の枠から画像がはみ出さないようにする。
  frame: { overflow: "hidden" },
});
