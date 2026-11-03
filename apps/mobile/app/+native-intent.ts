// expo-sharing の受信共有（iOS Share Extension / Android intent）は
// `<scheme>://expo-sharing` を開いてアプリを起動する（issue #316）。
// そのディープリンクだけ名刺受け取り画面に振り替え、
// QR の animeishi://user/... や OAuth コールバック等の他 URL は素通しする。
export function redirectSystemPath({ path }: { path: string }) {
  try {
    if (new URL(path).hostname === "expo-sharing") {
      return "/incoming-share";
    }
  } catch {
    // パース不能なパスは expo-router 既定の処理に委ねる
  }
  return path;
}
