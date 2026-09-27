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
export const annictExchangeSchema = z
  .object({
    code: z.string().trim().min(1, "認可コードが必要です"),
    // URI 形式まで検証する。deep link（animeishi://annict）も Web（http://...）も
    // URL としてパースできるため z.url() で両方許容しつつ、typo は 400 で弾く。
    redirectUri: z
      .string()
      .trim()
      .min(1, "redirect_uri が必要です")
      .url("redirect_uri の形式が正しくありません"),
    // 交換モードは必須。default を持たせると、Web クライアントが mode を落としたときに
    // native 分岐へ fail-open し accessToken がボディで漏れるため、明示指定を強制する。
    //   "native": トークンをボディで返し、クライアント(SecureStore)が保持する。
    //   "web":    トークンを D1 に暗号化保存し、ボディにトークンを含めない（clerkUserId で参照）。
    mode: z.enum(["native", "web"]),
  })
  // http(s) の redirectUri（＝Web）は必ず mode:"web" でなければならない。
  // Web が誤って native を指定してトークンをボディで受け取る事故を防ぐ。
  .refine((v) => !(/^https?:\/\//.test(v.redirectUri) && v.mode !== "web"), {
    error: 'Web の redirect_uri では mode:"web" が必要です',
    path: ["mode"],
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

// ---- tier 表 ----

// シーズン識別子。annict_works.seasonName と同じ "<年4桁>-<season>" 形式。
// worksSearchQuerySchema.season と同じ制約だが、あちらは optional なので共有せず
// 単体のスキーマとして切り出して両方から使う。
export const seasonSchema = z
  .string()
  .trim()
  .regex(
    /^\d{4}-(winter|spring|summer|autumn)$/,
    "シーズンの形式が正しくありません",
  );

// tier 表の 1 行（S / A / B ...）。key は items.tierKey から参照される識別子で、
// ラベル・色はユーザーが自由に変えられるため key とは別に持つ。
const tierRowSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, "tier のキーが必要です")
    .max(32, "tier のキーが長すぎます"),
  label: z
    .string()
    .trim()
    .min(1, "tier のラベルを入力してください")
    .max(24, "tier のラベルは24文字以内で入力してください"),
  // #RRGGBB 形式。クライアントのカラーピッカーが生成する形式に合わせる。
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "色の形式が正しくありません"),
});

const tierListItemSchema = z.object({
  annictWorkId: z.number().int().positive(),
  tierKey: z.string().trim().min(1),
});

export const tierListSaveSchema = z
  .object({
    season: seasonSchema,
    title: z
      .string()
      .trim()
      .min(1, "タイトルを入力してください")
      .max(50, "タイトルは50文字以内で入力してください"),
    tiers: z
      .array(tierRowSchema)
      .min(1, "tier を1つ以上設定してください")
      .max(12, "tier は12個までです")
      .refine(
        (rows) => new Set(rows.map((r) => r.key)).size === rows.length,
        "tier のキーが重複しています",
      ),
    // position はサーバが配列順から採番する。クライアントが送ってきた値は使わない
    // （順序の正が配列順とカラムの2か所に分かれると必ずズレるため）。
    items: z.array(tierListItemSchema).max(500, "作品数が多すぎます"),
  })
  // items.tierKey が tiers に存在しない = どの行にも描画されない幽霊配置になる。
  // FK が張れない参照なのでここで弾く。
  .refine(
    (v) => {
      const keys = new Set(v.tiers.map((t) => t.key));
      return v.items.every((item) => keys.has(item.tierKey));
    },
    { error: "存在しない tier が指定されています", path: ["items"] },
  )
  .refine(
    (v) => new Set(v.items.map((i) => i.annictWorkId)).size === v.items.length,
    { error: "同じ作品が複数の tier に配置されています", path: ["items"] },
  );

export type TierRowInput = z.infer<typeof tierRowSchema>;
export type TierListSaveInput = z.infer<typeof tierListSaveSchema>;

export const tierListSeasonParamSchema = z.object({ season: seasonSchema });

// ---- dアニメストア インポート ----

// インポート対象の 1 作品。クライアント（WebView 注入 / ブックマークレット）が
// マイページ HTML から抽出し、話数単位の履歴を作品単位に集約済みのものを受け取る。
// targetState はクライアントが決める（コンプリート → WATCHED、履歴のみ → WATCHING）。
export const danimeMatchWorkSchema = z.object({
  // workId が取れないカードはクライアント側で `title:<タイトル>` の疑似キーを
  // 使うため、タイトル長 + プレフィックス分の余裕を持たせる。
  danimeWorkId: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(500),
  targetState: z.enum(["WATCHED", "WATCHING"]),
});

export const danimeMatchRequestSchema = z.object({
  works: z
    .array(danimeMatchWorkSchema)
    .min(1)
    .max(500, "一度に照合できるのは500作品までです"),
  // ユーザーの Annict ライブラリに登録済みの annictWorkId（任意）。
  // 入力タイトルが期数を明示しているとき「登録済みの別シーズン」を候補から
  // 外すためのヒントに使う。照合の絞り込み用途のみで、登録処理には使わない。
  registeredWorkIds: z.array(z.number().int().positive()).max(5000).optional(),
});

export type DanimeMatchRequestInput = z.infer<typeof danimeMatchRequestSchema>;

// 一括登録の 1 件。作品メタや nodeId は受け付けず、サーバー側で
// キャッシュ → Annict searchWorks の順に解決する。
// クライアントが食い違う nodeId/メタを送ると共有作品キャッシュ（annict_works）
// が汚染され updateStatus が別作品に向くため、ここでは信頼しない。
export const watchHistoryBulkSchema = z.object({
  entries: z
    .array(
      z.object({
        annictWorkId: z.number().int().positive(),
        state: z.enum(ANNICT_STATUS_STATES, {
          error: () => "有効なステータスを選択してください",
        }),
      }),
    )
    .min(1)
    // 1 リクエストで叩ける Annict updateStatus の上限。これを超える分は
    // クライアント側でチャンク分割して逐次送信する（進捗表示にも使う）。
    .max(50, "一度に登録できるのは50作品までです"),
});

export type WatchHistoryBulkInput = z.infer<typeof watchHistoryBulkSchema>;
