import { z } from "zod";
import { WATCH_STATES } from "@/db/schema";
import { VALID_GENRES } from "../me/schema";
import type { Genre } from "../me/schema";
import type { WatchHistoryWithWork } from "../watch-history/repository";

// Workers AI で実行するモデル（issue #22）。日本語を含む多言語対応・
// response_format の json_schema に対応する instruct 系の中で
// 最安クラス（入力 $0.0509/M tokens）。変更時は Workers AI のモデル一覧で
// availability と structured output 対応を確認すること。
export const ANALYSIS_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8" as const;

// プロンプトに載せる履歴の上限。超過分は更新日時の新しい順に絞る
// （getMyWatchHistory は updated_at 降順で返す）。
const MAX_PROMPT_WORKS = 50;

// 応答の推奨ジャンル数の上限。
const MAX_RECOMMENDED_GENRES = 5;

// 傾向テキストの上限（生成モデルが長文化したときの切り詰め）。
const MAX_SUMMARY_CHARS = 600;

// watch_history.state をプロンプト用の日本語ラベルに変換する。
// モバイル側の WATCH_STATUS_LABELS（lib/useWatchHistory.ts）と同じ対応。
const STATE_LABELS: Record<(typeof WATCH_STATES)[number], string> = {
  WATCHING: "視聴中",
  WATCHED: "視聴済",
  ON_HOLD: "一時停止",
  STOP_WATCHING: "断念",
  WANNA_WATCH: "視聴予定",
};

/**
 * Workers AI の呼び出し・応答の解釈に失敗したときに投げるエラー。
 * ルート層で 502 に変換する。
 */
export class AnalysisGenerationError extends Error {
  constructor(message = "AI の応答を解釈できませんでした") {
    super(message);
    this.name = "AnalysisGenerationError";
  }
}

/** プロンプトへ渡す集計済み入力。computeInputHash のハッシュ対象でもある。 */
export type AnalysisInput = {
  /** 履歴の総件数（works は MAX_PROMPT_WORKS に丸めているため別途持つ）。 */
  totalCount: number;
  stateCounts: Partial<Record<(typeof WATCH_STATES)[number], number>>;
  /** プロンプト用: 更新日時が新しい順に MAX_PROMPT_WORKS 件。 */
  works: { annictWorkId: number; title: string; state: string }[];
  /**
   * ハッシュ用: 全履歴の (annictWorkId, state) 一覧。
   * works は 50 件に丸めているため、51 件目以降の変更（作品の入替・
   * 状態変更）も検出できるよう全件分を別途持つ。
   */
  workKeys: { annictWorkId: number; state: string }[];
  selectedGenres: string[];
};

/**
 * 視聴履歴＋選択ジャンルをプロンプト入力に集計する。
 * 作品は更新日時の新しい順に MAX_PROMPT_WORKS 件まで載せる。
 */
export function buildAnalysisInput(
  history: WatchHistoryWithWork[],
  selectedGenres: string[],
): AnalysisInput {
  const stateCounts: AnalysisInput["stateCounts"] = {};
  for (const row of history) {
    stateCounts[row.state] = (stateCounts[row.state] ?? 0) + 1;
  }
  return {
    totalCount: history.length,
    stateCounts,
    works: history.slice(0, MAX_PROMPT_WORKS).map((row) => ({
      annictWorkId: row.annictWorkId,
      title: row.title,
      state: row.state,
    })),
    workKeys: history.map((row) => ({
      annictWorkId: row.annictWorkId,
      state: row.state,
    })),
    selectedGenres,
  };
}

/**
 * 分析入力のハッシュ（SHA-256 hex）。キャッシュの有効判定に使う。
 * 作品の並び順に左右されないよう ID でソートしてからハッシュする
 * （Annict との再同期で updated_at 順が変わっただけでは無効化しない）。
 */
export async function computeInputHash(input: AnalysisInput): Promise<string> {
  const canonical = {
    totalCount: input.totalCount,
    // JSON.stringify は挿入順に左右されるため、WATCH_STATES の定義順で
    // 正規化する（履歴の走査順でキー順が変わるとハッシュが変わってしまう）。
    stateCounts: Object.fromEntries(
      WATCH_STATES.filter((s) => input.stateCounts[s] !== undefined).map(
        (s) => [s, input.stateCounts[s]],
      ),
    ),
    workKeys: [...input.workKeys].sort(
      (a, b) => a.annictWorkId - b.annictWorkId,
    ),
    selectedGenres: [...input.selectedGenres].sort(),
  };
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(canonical)),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const SYSTEM_PROMPT =
  "あなたはアニメ視聴傾向を分析するアシスタントです。" +
  "ユーザーの視聴履歴から傾向を読み取り、日本語で簡潔に回答してください。" +
  "出力は指定された JSON スキーマに厳密に従い、余分な文章を付けないでください。";

function buildUserPrompt(input: AnalysisInput): string {
  const stateLines = WATCH_STATES.map(
    (state) => `- ${STATE_LABELS[state]}: ${input.stateCounts[state] ?? 0} 件`,
  ).join("\n");
  const workLines = input.works
    .map(
      (w) =>
        `- 「${w.title}」（${STATE_LABELS[w.state as keyof typeof STATE_LABELS] ?? w.state}）`,
    )
    .join("\n");
  const genreLine =
    input.selectedGenres.length > 0
      ? input.selectedGenres.join("、")
      : "（未選択）";

  return [
    "以下はユーザーのアニメ視聴履歴です（Annict と同期した記録）。",
    "",
    `全 ${input.totalCount} 件の状態別件数:`,
    stateLines,
    "",
    `視聴履歴（最近更新された順に最大 ${MAX_PROMPT_WORKS} 件）:`,
    workLines,
    "",
    `ユーザーが選択しているジャンル: ${genreLine}`,
    "",
    "この履歴から視聴傾向を分析し、次を返してください:",
    "- summary: 視聴傾向の説明文（日本語・200 文字以内・断定しすぎない口調）",
    `- recommendedGenres: おすすめジャンルを次の候補から最大 ${MAX_RECOMMENDED_GENRES} つ: ${VALID_GENRES.join("、")}`,
  ].join("\n");
}

// モデルへ渡す JSON スキーマ（response_format: json_schema）。
const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    recommendedGenres: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["summary", "recommendedGenres"],
  additionalProperties: false,
} as const;

// モデル応答の検証。json_schema を渡しても空文字・不正形を返すことが
// あるため信用せず、受信側で必ず zod 検証する。
const aiOutputSchema = z.object({
  summary: z.string().trim().min(1),
  recommendedGenres: z.array(z.string()),
});

function extractMessageContent(result: unknown): string | null {
  // モデルによっては応答が素の文字列で返るケースがある。
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return null;
  const choices = (result as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;
  const message = (
    choices[0] as { message?: { content?: unknown } } | undefined
  )?.message;
  return typeof message?.content === "string" ? message.content : null;
}

function parseAiOutput(content: string): {
  summary: string;
  recommendedGenres: Genre[];
} {
  // ```json ... ``` のコードフェンスで包まれて返ることがあるため剥がす。
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    throw new AnalysisGenerationError("AI 応答が JSON ではありません");
  }
  const parsed = aiOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AnalysisGenerationError("AI 応答のスキーマが不正です");
  }
  // 候補リスト外のジャンル（ハルシネーション）は捨てる。
  const recommendedGenres = [...new Set(parsed.data.recommendedGenres)].filter(
    (g): g is Genre => (VALID_GENRES as readonly string[]).includes(g),
  );
  return {
    summary: parsed.data.summary.slice(0, MAX_SUMMARY_CHARS),
    recommendedGenres: recommendedGenres.slice(0, MAX_RECOMMENDED_GENRES),
  };
}

/**
 * Workers AI で視聴傾向を分析する。
 * @throws AnalysisGenerationError AI 呼び出し失敗・応答解釈失敗時
 */
export async function runAnalysis(
  ai: Ai,
  input: AnalysisInput,
): Promise<{ summary: string; recommendedGenres: Genre[] }> {
  let result: unknown;
  try {
    result = await ai.run(ANALYSIS_MODEL, {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: RESPONSE_JSON_SCHEMA,
      },
      max_tokens: 1024,
      temperature: 0.7,
    });
  } catch (err) {
    throw new AnalysisGenerationError(
      `Workers AI の呼び出しに失敗しました: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const content = extractMessageContent(result);
  if (content === null || content.trim() === "") {
    throw new AnalysisGenerationError("AI 応答が空です");
  }
  return parseAiOutput(content);
}
