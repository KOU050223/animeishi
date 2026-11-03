import type { RefObject } from "react";
import type { ViewInstance } from "react-native";

/**
 * マイ QR の画像保存に関するプラットフォーム差異吸収の共通インターフェース。
 * 実装は拡張子分割（.native.ts / .web.ts）で切り替わる。
 * 呼び出し側は常に `@/lib/qrImage` から import する。
 */

/**
 * 画面に描画済みの QR カード View を PNG 化して端末へ保存する。
 * - native: view-shot で撮り OS の共有シートへ渡す（保存先はユーザーが選ぶ）
 * - web: DOM を PNG 化してダウンロードする
 * title は共有シートのダイアログタイトル・保存ファイル名に使う。
 * backgroundColor は PNG の下地色（web のみで使う）。
 */
export type SaveQrImage = (
  target: RefObject<ViewInstance | null>,
  options: { title: string; backgroundColor: string },
) => Promise<void>;
