// dアニメ取り込みは App Store 審査 5.2.2（第三者サービスの利用許諾）リスク
// 回避のため v1.0 ではネイティブで無効化し、Web 版のみ提供する（#158）。
// 将来ネイティブでも再有効化したい場合は
// EXPO_PUBLIC_FEATURE_DANIME_IMPORT_NATIVE=true を設定する。
export const danimeImport =
  process.env.EXPO_PUBLIC_FEATURE_DANIME_IMPORT_NATIVE === "true";
