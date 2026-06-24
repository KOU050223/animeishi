import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-expo";
import * as ImagePicker from "expo-image-picker";
import { apiClient } from "@/lib/api";
import { compressAvatarImage } from "@/lib/imageCompression";
import { PROFILE_QUERY_KEY } from "@/lib/useProfile";

/** apiClient のベース URL を取得する。バイナリ body の PUT は RPC では扱いにくいため fetch で直接送る。 */
const AVATAR_UPLOAD_URL = apiClient.me.profile.avatar.$url().toString();

/**
 * 画像ライブラリから画像を 1 枚選択する。
 * 権限が拒否された場合・キャンセルされた場合は null を返す。
 */
export async function pickAvatarImage(): Promise<ImagePicker.ImagePickerAsset | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error("写真へのアクセスが許可されていません");
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });

  if (result.canceled || result.assets.length === 0) {
    return null;
  }
  return result.assets[0]!;
}

/**
 * プロフィール画像をアップロードするフック。
 * 画像選択 → 512px WebP 圧縮 → Worker(R2) へアップロード → プロフィールキャッシュ更新まで行う。
 *
 * mutate() を引数なしで呼ぶと画像選択から開始する。
 * 既に選択済みの asset がある場合は引数で渡せる。
 */
export function useProfileAvatarUpload() {
  const { getToken, userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (asset?: ImagePicker.ImagePickerAsset) => {
      const picked = asset ?? (await pickAvatarImage());
      if (!picked) return null;

      const token = await getToken();
      if (!token) throw new Error("認証トークンが取得できませんでした");

      const compressed = await compressAvatarImage(picked.uri, {
        width: picked.width,
        height: picked.height,
      });

      // 圧縮後のローカルファイルを取得して body として送る。
      const fileRes = await fetch(compressed.uri);
      const blob = await fileRes.blob();

      const res = await fetch(AVATAR_UPLOAD_URL, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "image/webp",
        },
        body: blob,
      });
      if (!res.ok) throw new Error("画像のアップロードに失敗しました");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: userId ? [...PROFILE_QUERY_KEY, userId] : PROFILE_QUERY_KEY,
      });
    },
  });
}
