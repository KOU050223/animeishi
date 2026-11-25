// 機能フラグの集約点。
// プラットフォームで既定値が異なるフラグは拡張子分割したモジュールから集める
// （danimeImport.ts / .web.ts / .native.ts。呼び出し側は拡張子なしで import する）。
import { danimeImport } from "./danimeImport";
import { googleSignIn } from "./googleSignIn";
import { passkey } from "./passkey";

export const featureFlags = {
  // デバッグ用途パネル。Release ビルドに出ないよう __DEV__ を必須条件にする。
  debugPanel: __DEV__ && process.env.EXPO_PUBLIC_FEATURE_DEBUG_PANEL === "true",
  // Apple Wallet への名刺追加。pkpass 署名が未実装（#103）のため v1.0 では
  // 既定非表示。実装完了後に EXPO_PUBLIC_FEATURE_WALLET=true で有効化する。
  wallet: process.env.EXPO_PUBLIC_FEATURE_WALLET === "true",
  // dアニメ取り込み。App Store 審査 5.2.2（第三者サービスの利用許諾）リスク
  // 回避のため v1.0 では Web 版のみ提供（#158）。ネイティブで再有効化する
  // 場合は EXPO_PUBLIC_FEATURE_DANIME_IMPORT_NATIVE=true を設定する。
  danimeImport,
  // 総選挙・イベント・特集記事。公開作業が本番 D1 の手作業に頼っている
  // （#743）ため v1.0 では既定非表示（#746）。Web も同じ扱い。
  // EXPO_PUBLIC_FEATURE_ELECTIONS / _EVENTS / _ARTICLES=true で有効化する。
  elections: process.env.EXPO_PUBLIC_FEATURE_ELECTIONS === "true",
  events: process.env.EXPO_PUBLIC_FEATURE_EVENTS === "true",
  articles: process.env.EXPO_PUBLIC_FEATURE_ARTICLES === "true",
  // キャラクター・自由作成 tier 表（#724）。v1.0 ではシーズン版のみ公開
  // するため既定非表示。有効化は
  // EXPO_PUBLIC_FEATURE_CHARACTER_TIER_LIST / _CUSTOM_TIER_LIST=true。
  characterTierList:
    process.env.EXPO_PUBLIC_FEATURE_CHARACTER_TIER_LIST === "true",
  customTierList: process.env.EXPO_PUBLIC_FEATURE_CUSTOM_TIER_LIST === "true",
  // Google ログイン（#89）。開発インスタンス（pk_test_）のみ既定 ON。
  googleSignIn,
  // パスキー（#181）。Web のみ。ネイティブは #107 待ちのため常に無効。
  passkey,
} as const;
