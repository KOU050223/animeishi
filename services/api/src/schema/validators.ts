import { z } from "zod";

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

// Annict の StatusState enum 値（NO_STATE は除く）
export const ANNICT_STATUS_STATES = [
  "WATCHING",
  "WATCHED",
  "ON_HOLD",
  "STOP_WATCHING",
  "WANNA_WATCH",
] as const;

export type AnnictStatusState = (typeof ANNICT_STATUS_STATES)[number];

export const watchHistoryUpsertSchema = z.object({
  state: z.enum(ANNICT_STATUS_STATES, {
    error: () => "有効なステータスを選択してください",
  }),
});

export type WatchHistoryUpsertInput = z.infer<typeof watchHistoryUpsertSchema>;

// Annict OAuth: モバイルが deep link で受領した認可コードを交換するリクエスト。
// redirect_uri はトークン交換時の検証に使われるため、モバイルが実際に使った値を
// そのまま送る（Annict アプリ設定に登録済みの deep link）。
export const annictExchangeSchema = z.object({
  code: z.string().trim().min(1, "認可コードが必要です"),
  // URI 形式まで検証する。deep link（animeishi://annict）も Web（http://...）も
  // URL としてパースできるため z.url() で両方許容しつつ、typo は 400 で弾く。
  redirectUri: z
    .string()
    .trim()
    .min(1, "redirect_uri が必要です")
    .url("redirect_uri の形式が正しくありません"),
});

export type AnnictExchangeInput = z.infer<typeof annictExchangeSchema>;

// 作品検索（GET /works/search）のクエリパラメータ。
// title は Annict searchWorks に渡す検索語。省略時はサーバーが「今期シーズン」を
// 既定にして初期表示（今期アニメ）を返す。season を明示すると任意シーズンを引ける。
// after はカーソルページング用。
export const worksSearchQuerySchema = z.object({
  // title は任意。省略・空文字（?title=）はどちらも「未指定」とみなし、route 側で
  // trim して空ならシーズン検索へフォールバックする。ここで min(1) を課さないのは、
  // 空文字を 400 にせず今期シーズン検索に流すため。
  title: z.string().trim().optional(),
  // 例: "2026-spring"。<年4桁>-<winter|spring|summer|autumn>。
  season: z
    .string()
    .trim()
    .regex(
      /^\d{4}-(winter|spring|summer|autumn)$/,
      "シーズンの形式が正しくありません",
    )
    .optional(),
  after: z.string().trim().min(1).optional(),
});

export type WorksSearchQueryInput = z.infer<typeof worksSearchQuerySchema>;
