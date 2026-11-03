import { createRoute, z } from "@hono/zod-openapi";
import { bearerAuth, errorResponseSchema } from "@/lib/openapi";

const INAPPROPRIATE_PATTERNS = [/死ね|殺す|バカ|アホ/, /https?:\/\/[^\s]+/];

const commentSchema = z
  .string()
  .trim()
  .max(500, "コメントは500文字以内で入力してください")
  .refine(
    (v) => !INAPPROPRIATE_PATTERNS.some((p) => p.test(v)),
    "不適切な内容が含まれています",
  )
  .optional();

const RESERVED_WORDS = ["admin", "root", "test", "system", "null", "undefined"];

const usernameSchema = z
  .string()
  .trim()
  .min(1, "ユーザー名を入力してください")
  .min(2, "ユーザー名は2文字以上で入力してください")
  .max(20, "ユーザー名は20文字以内で入力してください")
  .refine(
    (v) => /^[a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\-_ ]+$/.test(v),
    "ユーザー名に使用できない文字が含まれています",
  )
  .refine(
    (v) => !RESERVED_WORDS.includes(v.trim().toLowerCase()),
    "別のユーザー名を選択してください",
  );

export const VALID_GENRES = [
  "アクション",
  "コメディ",
  "ドラマ",
  "ファンタジー",
  "ホラー",
  "ミステリー",
  "ロマンス",
  "SF",
  "スポーツ",
  "アドベンチャー",
  "スリラー",
  "歴史",
  "音楽",
  "日常系",
  "異世界",
] as const;

export type Genre = (typeof VALID_GENRES)[number];

const genreSchema = z.enum(VALID_GENRES, {
  error: () => "有効なジャンルを選択してください",
});

export const profileUpdateSchema = z.object({
  username: usernameSchema.optional(),
  selectedGenres: z
    .array(genreSchema)
    .max(15)
    .refine(
      (genres) => new Set(genres).size === genres.length,
      "ジャンルが重複しています",
    )
    .optional(),
  bio: commentSchema,
  favoriteQuote: commentSchema,
  isPublic: z.boolean().optional(),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

// ---- OpenAPI ルート定義（issue #14）----

// users 行（Drizzle User 型の JSON 表現）。createdAt / updatedAt は ISO 文字列。
const userProfileSchema = z.object({
  id: z.string(),
  username: z.string(),
  bio: z.string().nullable(),
  favoriteQuote: z.string().nullable(),
  isPublic: z.boolean(),
  profileImageUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// 「いま見ている」吹き出し（issue #420）に載せる直近の話数記録 1 件。
// /user/:uid の JSON 応答と同じ形。直近 24 時間に記録が無ければ null。
const nowWatchingSchema = z.object({
  annictWorkId: z.number(),
  annictEpisodeId: z.number(),
  title: z.string(),
  titleEn: z.string().nullable(),
  seasonName: z.string().nullable(),
  seasonYear: z.number().nullable(),
  hostedImageUrl: z.string().nullable(),
  recordedAt: z.string(),
});

// GET /me/blocks の 1 件（BlockedUser。相手プロフィールを含む）。
const blockedUserSchema = z.object({
  blockedId: z.string(),
  createdAt: z.string(),
  username: z.string(),
  profileImageUrl: z.string().nullable(),
});

// 画像バイナリの request body（webp / jpeg / png）。
// バリデーションはハンドラ側で Content-Type・サイズを見るため、
// ここはドキュメント用途のみ。
const imageBinaryBody = {
  content: {
    "image/webp": {
      schema: z.string().openapi({ format: "binary" }),
    },
    "image/jpeg": {
      schema: z.string().openapi({ format: "binary" }),
    },
    "image/png": {
      schema: z.string().openapi({ format: "binary" }),
    },
  },
  required: true,
};

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

export const getProfileRoute = createRoute({
  method: "get",
  path: "/profile",
  tags: ["me"],
  summary: "自分のプロフィールを取得する",
  security: bearerAuth,
  responses: {
    200: {
      content: {
        "application/json": {
          schema: userProfileSchema.extend({
            nowWatching: nowWatchingSchema.nullable(),
          }),
        },
      },
      description: "プロフィール",
    },
    401: jsonError("未認証"),
    404: jsonError("プロフィールが存在しない"),
  },
});

export const updateProfileRoute = createRoute({
  method: "put",
  path: "/profile",
  tags: ["me"],
  summary: "プロフィールを作成・更新する",
  security: bearerAuth,
  request: {
    body: {
      content: { "application/json": { schema: profileUpdateSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: userProfileSchema } },
      description: "更新後のプロフィール",
    },
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
  },
});

export const getBlocksRoute = createRoute({
  method: "get",
  path: "/blocks",
  tags: ["me"],
  summary: "自分がブロックしているユーザー一覧を取得する",
  security: bearerAuth,
  responses: {
    200: {
      content: { "application/json": { schema: z.array(blockedUserSchema) } },
      description: "ブロック一覧（ブロック日時の降順）",
    },
    401: jsonError("未認証"),
  },
});

export const uploadAvatarRoute = createRoute({
  method: "put",
  path: "/profile/avatar",
  tags: ["me"],
  summary: "プロフィール画像（アバター）をアップロードする",
  description:
    "圧縮済み画像バイナリ（webp / jpeg / png、5MB まで）をそのまま body に載せる。",
  security: bearerAuth,
  request: { body: imageBinaryBody },
  responses: {
    200: {
      content: { "application/json": { schema: userProfileSchema } },
      description: "更新後のプロフィール",
    },
    400: jsonError("非対応の形式・空・サイズ超過"),
    401: jsonError("未認証"),
  },
});

export const uploadMeishiAssetRoute = createRoute({
  method: "post",
  path: "/meishi-assets",
  tags: ["me"],
  summary: "名刺エディタ用の画像をアップロードする",
  description:
    "圧縮済み画像バイナリ（webp / jpeg / png、500KB・ユーザーあたり 200 件まで）をそのまま body に載せる。",
  security: bearerAuth,
  request: { body: imageBinaryBody },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: z.object({ url: z.string() }),
        },
      },
      description: "アップロードした画像の配信 URL",
    },
    400: jsonError("非対応の形式・空・サイズ超過・件数上限"),
    401: jsonError("未認証"),
  },
});

// DELETE /me で消えるデータの件数（退会フローの確認画面用, issue #426）。
// tierLists はシーズン・キャラクター・自由作成の 3 種の合計。
const deletionSummarySchema = z.object({
  watchHistories: z.number(),
  favorites: z.number(),
  friends: z.number(),
  tierLists: z.number(),
  workLists: z.number(),
});

// POST /me/deletion-feedback のボディ。reasons のキーはクライアント側で
// 管理するため、API 側は文字列の集合だけを検証する（選択肢を追加しても
// サーバーのデプロイを要しないようにする）。
export const deletionFeedbackSchema = z
  .object({
    reasons: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    freeText: z.string().trim().min(1).max(500).optional(),
  })
  .refine((v) => v.reasons.length > 0 || v.freeText !== undefined, {
    message: "理由または自由記述のどちらかを入力してください",
  });

export type DeletionFeedbackInput = z.infer<typeof deletionFeedbackSchema>;

export const getDeletionSummaryRoute = createRoute({
  method: "get",
  path: "/deletion-summary",
  tags: ["me"],
  summary: "アカウント削除で消えるデータの件数を取得する",
  security: bearerAuth,
  responses: {
    200: {
      content: { "application/json": { schema: deletionSummarySchema } },
      description: "削除対象データの件数",
    },
    401: jsonError("未認証"),
  },
});

export const postDeletionFeedbackRoute = createRoute({
  method: "post",
  path: "/deletion-feedback",
  tags: ["me"],
  summary: "退会理由を匿名で記録する",
  description:
    "退会フローで任意入力された理由を user_id と紐付けずに保存する（集計専用）。",
  security: bearerAuth,
  request: {
    body: {
      content: { "application/json": { schema: deletionFeedbackSchema } },
      required: true,
    },
  },
  responses: {
    201: { description: "記録した" },
    400: jsonError("入力エラー"),
    401: jsonError("未認証"),
  },
});

export const deleteMeRoute = createRoute({
  method: "delete",
  path: "/",
  tags: ["me"],
  summary: "自分のアカウントを削除する",
  description:
    "D1 のユーザーデータ・R2 の画像・Clerk ユーザー本体を削除する（審査要件の削除導線）。",
  security: bearerAuth,
  responses: {
    204: { description: "削除した" },
    401: jsonError("未認証"),
  },
});
