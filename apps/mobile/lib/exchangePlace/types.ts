/**
 * 「出会った場所」を残すための位置解決（issue #661）の共通型。
 * 呼び出し側は常に `@/lib/exchangePlace` から import する。
 */

/**
 * 位置解決の結果。座標はモジュール内で地名に変換して破棄し、
 * 呼び出し側にはテキストだけを返す（座標を返す API は作らない）。
 */
type ResolvePlaceResult =
  | { kind: "ok"; name: string }
  // 許可が下りなかった。呼び出し側は手入力で場所を残せるフォールバックを出す。
  | { kind: "denied" }
  // 位置が取れなかった・逆ジオコーディングに失敗した。
  | { kind: "unavailable" };

/** 「場所を残す」ボタン押下時に呼ぶ。権限要求はこの呼び出し時だけ行う。 */
export type ResolvePlaceName = () => Promise<ResolvePlaceResult>;
