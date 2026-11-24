// dアニメ取り込みは v1.0 からネイティブでも有効（#751。#158 の無効化を戻す）。
// App Store 審査 5.2.2（第三者サービスの利用許諾）で指摘された場合は
// EXPO_PUBLIC_FEATURE_DANIME_IMPORT_NATIVE=false を設定してビルドし直し、
// 再提出する。切り戻すときは store.config.json の説明文と
// docs/store-listing.md の審査メモからも機能記載を外す
// （説明文にない機能の提供は問題ないが、ある機能が無いと 2.3 抵触になる）。
// リリース後の停止は PostHog のキルスイッチ側（#758）で行う。
export const danimeImport =
  process.env.EXPO_PUBLIC_FEATURE_DANIME_IMPORT_NATIVE !== "false";
