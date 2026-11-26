import type { RefObject } from "react";
import type { ViewInstance } from "react-native";

/**
 * 受け取った名刺（公開スナップショット画像）の保存に関する
 * プラットフォーム差異吸収の共通インターフェース（issue #675）。
 *
 * 実装は拡張子分割で切り替わる:
 * - saveReceivedMeishi.native.ts ... iOS/Android（view-shot + OS 共有シート）
 * - saveReceivedMeishi.web.ts    ... Web（画像 URL の fetch → ダウンロード）
 *
 * 呼び出し側は常に `@/features/received-meishi` から import する。
 */

/**
 * 公開名刺スナップショット画像を端末へ保存する。
 * - native: target の View を撮って共有シートへ渡す（保存先はユーザーが選ぶ）
 * - web: imageUrl を fetch し、元の PNG をそのままダウンロードする
 * title は共有シートのダイアログタイトル・保存ファイル名に使う。
 * target の View は collapsable={false} で描画されていること
 * （Android で View がフラット化されると captureRef が失敗するため）。
 */
export type SaveReceivedMeishi = (input: {
  /** 公開スナップショット画像の URL（web のダウンロード元）。 */
  imageUrl: string;
  /** 名刺画像を描画している View（native の撮影対象）。 */
  target: RefObject<ViewInstance | null>;
  /** 共有シートのダイアログタイトル / 保存ファイル名。 */
  title: string;
}) => Promise<void>;
