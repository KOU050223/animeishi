import { newId } from "@/lib/meishi/defaults";
import type { MeishiTemplate } from "@/lib/meishi/templates";
import type { AnimeCollageElement, MeishiDocument } from "@/lib/meishi/types";

/**
 * オンボーディングで選んだ推しを名刺に反映するコラージュ要素（issue #412）。
 * 既存テンプレートはお気に入りを表示する要素を持たないため、
 * テンプレート適用後にこの要素を末尾へ追加して「推し 3 作」が
 * 名刺上に見える形にする。
 */
function favoritesCollageElement(): AnimeCollageElement {
  return {
    id: newId(),
    type: "animeCollage",
    // 既存テンプレート（classic 等）で要素が比較的空いている左下に置く。
    transform: { x: 0.05, y: 0.76, width: 0.55, height: 0.2, rotation: 0 },
    cols: 3,
    rows: 1,
    sortBy: "recent",
    limit: 3,
    gap: 0.01,
    listSource: "favorites",
  };
}

/**
 * オンボーディング用の名刺ドキュメントを組み立てる。
 * 名刺エディタの既存テンプレート（lib/meishi/templates.ts）に
 * 推しコラージュを載せたもの。テンプレート選択時にそのまま保存する。
 */
export function buildOnboardingDocument(
  template: MeishiTemplate,
): MeishiDocument {
  const doc = template.build();
  return {
    ...doc,
    elements: [...doc.elements, favoritesCollageElement()],
  };
}
