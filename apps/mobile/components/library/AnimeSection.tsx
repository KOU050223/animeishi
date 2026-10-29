import { AnimeListContent } from "@/components/anime-list";
import { useFavoriteIds, useToggleFavorite } from "@/lib/useFavorites";
import { ApiRequestError } from "@/lib/apiError";
import { alert } from "@/lib/dialog";

// ライブラリタブの「アニメ」セクション（旧アニメ一覧タブ）。
// initialQuery は検索遷移（issue #335 のおすすめカードからの導線）で
// 検索語を入れた状態で開くための初期値。変わるたびに検索欄を
// リセットするため AnimeListContent の key に使う。
export function AnimeSection({ initialQuery }: { initialQuery?: string }) {
  const favoriteIds = useFavoriteIds();
  const { toggle, isPending: isToggling } = useToggleFavorite(favoriteIds, {
    // トグル失敗は画面に変化が残らないため、OK を押すまで消えない
    // ダイアログで必ず伝える（視聴ステータス更新と同じ方針）。
    // ApiRequestError はユーザー向け日本語メッセージを持つ。ネットワーク断等の
    // 技術メッセージはそのまま出さず固定文言に寄せる。
    onError: (e) =>
      alert(
        "お気に入りを更新できませんでした",
        e instanceof ApiRequestError
          ? e.message
          : "お気に入りの更新に失敗しました",
        { okLabel: "OK" },
      ),
  });

  return (
    <AnimeListContent
      key={initialQuery ?? ""}
      initialQuery={initialQuery}
      favoriteIds={favoriteIds}
      toggleFavorite={toggle}
      isToggling={isToggling}
    />
  );
}
