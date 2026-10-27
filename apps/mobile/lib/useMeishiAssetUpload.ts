import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import * as ImagePicker from "expo-image-picker";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { compressMeishiImage } from "@/lib/imageCompression";

/** apiClient のベース URL を取得する。バイナリ body の POST は RPC では扱いにくいため fetch で直接送る。 */
const MEISHI_ASSET_UPLOAD_URL = apiClient.me["meishi-assets"].$url().toString();

/**
 * 画像ライブラリから名刺用の画像を 1 枚選択する。
 * アバター（useProfileAvatar.pickAvatarImage）と違い正方形クロップは強制しない
 * — 名刺の画像要素は任意の縦横比を取るため。
 * 権限が拒否された場合・キャンセルされた場合は null を返す。
 */
export async function pickMeishiImage(): Promise<ImagePicker.ImagePickerAsset | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error("写真へのアクセスが許可されていません");
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 1,
  });

  if (result.canceled || result.assets.length === 0) {
    return null;
  }
  return result.assets[0];
}

/**
 * 名刺画像をアップロードするフック。
 * 1024px WebP 圧縮 → POST /me/meishi-assets → R2 → 配信 URL を返す。
 * 成功時の戻り値は { url }（要素の uri にそのまま保存する）。
 */
export function useMeishiAssetUpload() {
  const { getToken } = useAuth();

  // アップロード結果（URL）は名刺ドキュメントの要素に直接書き込むため、
  // 無効化すべきクエリキャッシュは存在しない（サーバー側に一覧 API もない）。
  return useMutation({
    mutationFn: async (asset: ImagePicker.ImagePickerAsset) => {
      const token = await getToken();
      if (!token) throw new Error("認証トークンが取得できませんでした");

      const compressed = await compressMeishiImage(asset.uri, {
        width: asset.width,
        height: asset.height,
      });

      // ローカル file:// の読み取りは HTTP ではないため status でなく
      // 中身の有無で成否を判定する（file:// の status は環境により 0 になる）。
      const fileRes = await fetch(compressed.uri);
      const blob = await fileRes.blob();
      if (blob.size === 0) {
        throw new Error("画像の読み込みに失敗しました");
      }

      const res = await fetch(MEISHI_ASSET_UPLOAD_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "image/webp",
        },
        body: blob,
      });
      if (!res.ok) {
        // API は { error } を返す（サイズ超過・非対応形式など）。拾える場合はその文言を見せる。
        const errBody = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new ApiRequestError(
          res.status,
          errBody?.error ?? "画像のアップロードに失敗しました",
        );
      }
      return (await res.json()) as { url: string };
    },
  });
}
