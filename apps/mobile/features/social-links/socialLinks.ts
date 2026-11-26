import { useAuth } from "@clerk/expo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PUBLIC_PROFILE_QUERY_KEY } from "@/features/user/publicProfile";
import { apiClient, apiFetch, clerkSessionToken } from "@/lib/api";
import { socialLinkQueries } from "@/lib/queries/socialLinks";

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

export function socialLinkLabel(kind: SocialLinkKind): string {
  switch (kind) {
    case "x":
      return "X";
    case "pixiv":
      return "pixiv";
    case "fanbox":
      return "FANBOX";
    case "dlsite":
      return "DLsite";
    case "dmm":
      return "DMM / FANZA";
    case "youtube":
      return "YouTube";
    case "other":
      return "URL";
  }
}

export function useSocialLinks() {
  const { userId } = useAuth();
  return useQuery({
    ...socialLinkQueries.list.query({ userId }),
    enabled: !!userId,
  });
}

export function useSaveSocialLinks() {
  const { userId } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (items: SocialLinkInput[]) => {
      // トークン欠如は "Unauthorized" の plain Error を投げる
      // 移行前の契約を維持する（apiFetch の i18n 文言とは別契約）。
      if (!(await clerkSessionToken())) throw new Error("Unauthorized");
      const res = await apiClient.me["social-links"].$put(
        { json: { items } },
        {
          fetch: apiFetch({
            errorMessage: "SNS リンクの保存に失敗しました",
          }),
        },
      );
      return res.json();
    },
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: socialLinkQueries.key(userId),
      });
      await client.invalidateQueries({
        queryKey: [...PUBLIC_PROFILE_QUERY_KEY, userId],
      });
    },
  });
}
