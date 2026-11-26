import { useEffect, useState } from "react";
import { useAuth } from "@clerk/expo";
import { buildProfileUrl } from "@/lib/profileUrl";
import { buildQrExchangeUrl } from "@/features/friends/qrParser";
import { readOfflineExchangeToken } from "@/features/friends/offlineExchangeToken";
import { useProfile } from "@/features/me/useProfile";
import { useQrExchangeToken } from "@/features/friends/useFriends";

/**
 * 対面交換で相手に渡す自分の交換データ（QR に載せる URL）。
 * マイ QR の表示と、近づけて交換で相手へ送るデータ（issue #693）で共有する。
 * 未サインインのときは qrValue / shareUrl とも null。
 */
export function useExchangeQrValue(): {
  qrValue: string | null;
  /**
   * 近づけて交換で相手へ送るデータ。qrValue と同じ URL に、qt があっても
   * ot を併記する（qt の期限後にオフラインの交換キューを同期できるように）。
   */
  nearbyPayload: string | null;
  shareUrl: string | null;
} {
  const { userId, isSignedIn } = useAuth();
  const { data: profile } = useProfile();
  // 対面交換 QR に埋め込む短期トークン。トークン無しの QR を提示しても
  // 読み取り側は即時成立できず申請画面に送られるだけなので、取得失敗時も
  // トークン無しのまま表示してよい（issue #417）。
  const qrToken = useQrExchangeToken();
  // qt が取れないとき（オフライン）だけ QR に載せる ot（issue #680）。
  // オンラインのうちに useQrExchangeToken が AsyncStorage へ保存したものを
  // 読む。取得・再取得のたびにキャッシュが新しくなるため、その都度読み直す。
  const [offlineToken, setOfflineToken] = useState<string | null>(null);
  // Date.now はレンダー中に呼べない（React Compiler の purity 制約）ため、
  // 時刻は state に持ちタイマー発火時にだけ更新する。qt の期限到達時刻に
  // nowMs を更新し、オフラインで再取得が止まっていても期限切れの qt を
  // QR から外して ot へ切り替える（errorUpdatedAt も依存に入れるのは、
  // 再取得失敗でも時刻評価をやり直すため）。初期値 0 は「qt 有効」と同じ
  // 評価になる。期限切れ済みの qt でも遅延 0 のタイマーが即時発火して
  // 1 ティック後に ot へ切り替わる。
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const expMs = qrToken.data ? qrToken.data.expiresAt * 1000 : null;
    // setTimeout の遅延は 32bit 上限（約 24.8 日）まで。超えると即時
    // 発火扱いになるためキャップする（qt の実際の TTL は 5 分で、
    // 上限を超えるのはテストなど人為的な値だけ）。
    const delay =
      expMs === null
        ? 2 ** 31 - 1
        : Math.min(Math.max(expMs - Date.now(), 0), 2 ** 31 - 1);
    // タイマーは期限より 1ms ほど早く発火することがあり、そのまま Date.now()
    // を入れると qt が有効のまま残って二度と再評価されない（このタイマーは
    // 張り直さない）。期限に達したことを確実に反映するため期限以上に揃える。
    const timer = setTimeout(
      () => setNowMs(Math.max(Date.now(), expMs ?? 0)),
      delay,
    );
    let cancelled = false;
    if (userId) {
      void readOfflineExchangeToken(userId).then((token) => {
        if (!cancelled) setOfflineToken(token);
      });
    }
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, qrToken.dataUpdatedAt, qrToken.errorUpdatedAt]);

  if (!isSignedIn || !userId) {
    return { qrValue: null, nearbyPayload: null, shareUrl: null };
  }
  const shareUrl = buildProfileUrl(userId) ?? userId;
  // 対面の読み合いだけ即時成立にするため、表示する QR には本人紐づきの
  // 短期トークンを載せる（issue #417）。リンク・画像共有にはトークンを
  // 載せない shareUrl を使い回し、遠隔では申請フローに限定する。
  // qt は期限内のものだけ有効。取れない・期限切れのときだけキャッシュ済みの
  // ot にフォールバックする（issue #680、オーナー決定 2026-11-21）。
  const qt =
    qrToken.data && qrToken.data.expiresAt * 1000 > nowMs
      ? qrToken.data.token
      : undefined;
  const miniMeishi = {
    username: profile?.username,
    avatarUrl: profile?.profileImageUrl ?? undefined,
  };
  const qrValue = buildQrExchangeUrl(shareUrl, {
    qt,
    ot: qt ? undefined : offlineToken,
    miniMeishi,
  });
  // 端末に保存した ot の読み出しは非同期なので、取得済みの応答に ot が
  // あればそれを優先する（読み出し前に送ると ot の無いデータが送信済みになる）。
  const nearbyOt =
    qrToken.data && qrToken.data.offlineExpiresAt * 1000 > nowMs
      ? qrToken.data.offlineToken
      : offlineToken;
  // トークンが 1 つも無いデータは受け取った側で交換に使えないので、
  // 送らない（探索も始めない）。
  const nearbyPayload =
    qt || nearbyOt
      ? buildQrExchangeUrl(shareUrl, {
          qt,
          ot: nearbyOt,
          miniMeishi,
          includeOfflineWithQt: true,
        })
      : null;
  return { qrValue, nearbyPayload, shareUrl };
}
