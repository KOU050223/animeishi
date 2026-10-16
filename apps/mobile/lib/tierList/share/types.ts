import type { ReactNode, RefObject } from "react";
import type { View } from "react-native";

/**
 * tier 表の共有に関するプラットフォーム差異吸収の共通インターフェース。
 * 実装は拡張子分割（.native.ts / .web.ts）で切り替わる。
 * 呼び出し側は常に `@/lib/tierList/share` から import する。
 */

/**
 * 共有方法の選択肢を提示する。
 * ボタン文言は基盤側に既定値を持たせず、必ず呼び出し側が渡す。
 */
export type PresentTierShareOptions = (input: {
  dialogTitle: string;
  urlLabel: string;
  imageLabel: string;
  cancelLabel: string;
  onShareUrl: () => void;
  onShareImage: () => void;
}) => void;

/**
 * 共有 URL を OS の共有シート or クリップボードへ渡す。
 * 戻り値は完了方法:
 * - "shared"  共有シートを開いた（キャンセルも含む）
 * - "copied"  クリップボードにコピーした
 * - "blocked" 自動では渡せなかった（Web でユーザー操作の有効期限が切れた等）。
 *   呼び出し側は次のユーザー操作内で copyTierListUrl を呼ぶ導線を出すこと。
 */
export type ShareTierListUrl = (
  url: string,
) => Promise<"shared" | "copied" | "blocked">;

/**
 * ユーザーの明示操作（ボタン押下など）内で呼ぶクリップボードコピー。
 * shareTierListUrl が "blocked" を返したあとのリカバリ導線に使う。
 */
export type CopyTierListUrl = (url: string) => Promise<void>;

/**
 * 共有 URL をユーザーへ届ける手段を提供するフック。
 * - native: OS の共有シートを開く（shareTierListUrl に委譲）
 * - web: 共有モーダルを開き [Xで共有] / [URLをコピー] をユーザー操作で実行。
 *   保存・トークン発行のネットワーク待ちの後に navigator.share / clipboard を
 *   自動呼び出しするとブラウザのユーザー操作期限で拒否されるため、Web では
 *   URL 発行後にモーダルへ切り替える。
 */
export type UseTierUrlShare = (input?: {
  /** X 共有インテントに載せる投稿テキスト（native では無視） */
  tweetText?: string;
  /**
   * Web 共有モーダルの画像ボタンから呼ばれる画像生成ハンドラ。
   * 保存・スナップショット描画・PNG 化までを行い File を返す。
   * 生成待ちでブラウザのユーザー操作期限が切れるため、共有シート /
   * ダウンロードへの受け渡しは生成完了後にモーダル内の別ボタンで行う。
   * native では無視される。未指定なら画像ボタンを出さない。
   */
  generateImageFile?: () => Promise<File>;
}) => {
  /** URL をユーザーへ届ける。戻り値の意味は ShareTierListUrl と同じ。 */
  shareUrl: ShareTierListUrl;
  /**
   * Web 共有モーダルの描画要素。native では常に null。
   * Web でモーダルを出す唯一の経路なので、画面の JSX に必ず描画すること。
   */
  urlShareElement: ReactNode;
};

/**
 * キャプチャ対象の View を PNG 化して共有シートへ渡す。
 * - native: react-native-view-shot で View を撮り OS 共有シートへ
 * - web: DOM を html-to-image で PNG 化し、Web Share API (files) または
 *   ダウンロードへ（web の View ref は RNW 経由で HTMLElement に解決される）
 * backgroundColor は PNG の下地色。スナップショット自体が塗るので
 * 縁のかけら用だが、呼び出し側は撮影時点の画面背景色を渡す
 * （native では無視される）。
 */
export type ShareTierListImage = (
  target: RefObject<View | null>,
  options: { dialogTitle: string; backgroundColor: string },
) => Promise<void>;

/**
 * キャプチャ対象の View を PNG 化して File として返す。
 * Web 共有モーダルの画像生成（generateImageFile）専用で、
 * 共有シート・ダウンロードへの受け渡しは呼び出し側が行う。
 * native では使われない（native は shareTierListImage が直接共有する）。
 */
export type CaptureTierListImageFile = (
  target: RefObject<View | null>,
  options: { title: string; backgroundColor: string },
) => Promise<File>;
