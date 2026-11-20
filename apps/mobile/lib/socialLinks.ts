import { useAuth } from "@clerk/expo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";

export type SocialLinkKind =
  | "x"
  | "pixiv"
  | "fanbox"
  | "dlsite"
  | "dmm"
  | "youtube"
  | "other";
export type SocialLinkVisibility = "public" | "friends" | "private";
export type SocialLinkInput = {
  kind: SocialLinkKind;
  value: string;
  visibility: SocialLinkVisibility;
};
export type SocialLink = SocialLinkInput & { url: string };

export const SOCIAL_LINK_KINDS: SocialLinkKind[] = [
  "x",
  "pixiv",
  "fanbox",
  "dlsite",
  "dmm",
  "youtube",
  "other",
];

export function useSocialLinks() {
  const { getToken, userId } = useAuth();
  return useQuery({
    queryKey: ["social-links", userId],
    enabled: !!userId,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Unauthorized");
      const res = await apiClient.me["social-links"].$get(
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok)
        throw new ApiRequestError(res.status, "SNS リンクの取得に失敗しました");
      return res.json();
    },
  });
}

export function useSaveSocialLinks() {
  const { getToken, userId } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (items: SocialLinkInput[]) => {
      const token = await getToken();
      if (!token) throw new Error("Unauthorized");
      const res = await apiClient.me["social-links"].$put(
        { json: { items } },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok)
        throw new ApiRequestError(res.status, "SNS リンクの保存に失敗しました");
      return res.json();
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["social-links", userId] });
      await client.invalidateQueries({ queryKey: ["public-profile", userId] });
    },
  });
}
