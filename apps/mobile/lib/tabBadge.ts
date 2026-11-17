/**
 * タブバッジに出す文字列。0 件以下なら undefined（バッジを出さない）。
 *
 * expo-router の NativeTabs.Trigger.Badge は、子要素に空でない文字列があると
 * hidden を無視して表示する（appendBadgeOptions）。"0" を渡すと 0 件でも
 * バッジが出てしまうため、0 件のときは子要素そのものを渡さない。
 */
export function tabBadgeText(count: number): string | undefined {
  return count > 0 ? String(count) : undefined;
}
