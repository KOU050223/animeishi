// API が返す Annict トークン起因のエラーを、その場で連携/再連携できる
// ダイアログに変換する（issue #423）。
// - annict_token_required: トークン未登録（requireAnnictToken で 401）
// - annict_token_invalid : 登録済みトークンが Annict 側で失効・取り消し
//   （Annict API の 401 を annictErrorResponse が 401 に変換したもの）
// どちらも「連携し直せば直る」ため、汎用エラーではなく連携導線を出す。
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AnnictFunnelSurface } from "@animeishi/observability";
import { ApiRequestError } from "@/lib/apiError";
import { alert, confirm } from "@/lib/dialog";
import { WATCH_HISTORY_QUERY_KEY } from "@/lib/watchHistoryKey";
import { annictErrorKey } from "./errorMessages";
import { useAnnictFunnel } from "./funnel";
import { useAnnictConnect } from "./useAnnictConnect";

const ANNICT_TOKEN_ERROR_CODES: ReadonlySet<string> = new Set([
  "annict_token_required",
  "annict_token_invalid",
]);

/** API エラーが Annict トークンの未登録・失効によるものか判定する。 */
export function isAnnictTokenError(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    error.code !== undefined &&
    ANNICT_TOKEN_ERROR_CODES.has(error.code)
  );
}

/**
 * 記録系 API が Annict トークン起因で失敗したときに「連携する / あとで」の
 * ダイアログを出し、「連携する」で OAuth 連携をその場で開始するフック。
 * 返す関数はエラーを処理したとき true を返す。false のときは呼び出し側が
 * 従来どおりの汎用エラー処理を行う。
 */
export function useAnnictTokenErrorPrompt(surface: AnnictFunnelSurface) {
  const { t } = useTranslation();
  const { connect } = useAnnictConnect();
  const track = useAnnictFunnel(surface);
  const queryClient = useQueryClient();

  return useCallback(
    (error: unknown): boolean => {
      if (!isAnnictTokenError(error)) return false;
      track("prompt_view");
      confirm(
        t("Annict 連携が必要です"),
        t("Annict と連携すると視聴記録を残せます"),
        () => {
          track("cta_tap");
          void connect({ surface }).then((result) => {
            // 連携自体の失敗はソフトゲートと同じ文言対応（annictErrorKey）で
            // 通知する。キャンセルはダイアログ側の導線が閉じるだけなので出さない。
            if (result.status === "error") {
              alert(
                t("Annict 連携に失敗しました"),
                t(annictErrorKey(result.reason)),
                { okLabel: "OK" },
              );
              return;
            }
            if (result.status === "success") {
              // 再連携で別アカウントに切り替わると、旧トークンで取った
              // viewerStatusState が新アカウントの実状態とずれるため、
              // 作品詳細と視聴履歴を新トークンで再取得させる。
              // useWorkDetail を import すると循環参照になるため、
              // WORK_DETAIL_QUERY_KEY（["works", "detail"]）はリテラルで書く
              // （useAnnictConnect の disconnect と同じ扱い）。
              void queryClient.invalidateQueries({
                queryKey: ["works", "detail"],
              });
              void queryClient.invalidateQueries({
                queryKey: WATCH_HISTORY_QUERY_KEY,
              });
            }
          });
        },
        { confirmLabel: t("連携する"), cancelLabel: t("あとで") },
      );
      return true;
    },
    [connect, queryClient, surface, track, t],
  );
}
