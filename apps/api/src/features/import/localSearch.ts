// D1 の annict_works キャッシュを使ったローカル作品検索（issue #219）。
//
// Annict searchWorks（title_or_title_kana_cont_any → ILIKE 部分一致）と
// 同じ方向で、title / title_kana / title_en のいずれかに入力タイトルを
// 含む行を union で返す（部分一致は instr で実現する。D1 の LIKE
// パターン 50 バイト上限と %/_ のワイルドカード解釈を避けるため）。
// スコアリング・照合は core 側に任せるため、
// ここでは「候補を広めに拾う」ことだけを担う。
// 再インポートでは大半の作品がキャッシュ済みのため、Annict への往復
// （＝サブリクエスト消費）をここで大きく削れる。
import { desc, or, sql } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { annictWorks } from "@/db/schema";
import type { AnnictSearcher, DanimeAnnictWork } from "@animeishi/danime-core";

// 1 クエリで返す行数の上限。短い・汎用的なタイトルでも候補プールが
// 際限なく膨らまないよう頭打ちにする（Annict の first:50 に準じた量級）。
const LOCAL_SEARCH_MAX_ROWS = 200;

// LIKE パターンに入る前に取り除く制御文字（Annict 側の sanitizeSearchTitle
// と同じく、混入 1 件でクエリ全体が壊れないよう事前に除く）。
const CONTROL_CHARS = /\p{Cc}/gu;

/**
 * annict_works キャッシュ検索の AnnictSearcher 実装。
 * consume（サブリクエスト予算）を先に消費してから D1 に問い合わせ、
 * 残りが無ければ検索せず null（= pending 扱い）を返す。
 */
export function createLocalWorkSearcher(
  db: DrizzleDb,
  consume: () => boolean,
): AnnictSearcher {
  return async (titles) => {
    const queries = [
      ...new Set(
        titles
          .map((t) => t.replace(CONTROL_CHARS, "").trim())
          .filter((t) => t.length > 0),
      ),
    ];
    if (queries.length === 0) return [];
    if (!consume()) return null;

    // Annict の部分一致（title_or_title_kana_cont_any）と同じく「含む」
    // 検索をするが、LIKE ではなく instr を使う。D1 の LIKE パターンは
    // 50 バイト上限があり、日本語タイトル（1 文字 3 バイト）では容易に
    // 超えてクエリ全体が失敗する。instr なら % / _ を含むタイトルも
    // ワイルドカードではなくリテラルとして扱える。
    let rows;
    try {
      rows = await db
        .select({
          annictWorkId: annictWorks.annictWorkId,
          nodeId: annictWorks.nodeId,
          title: annictWorks.title,
          titleKana: annictWorks.titleKana,
          titleEn: annictWorks.titleEn,
          seasonName: annictWorks.seasonName,
          seasonYear: annictWorks.seasonYear,
          imageUrl: annictWorks.imageUrl,
          malAnimeId: annictWorks.malAnimeId,
        })
        .from(annictWorks)
        .where(
          or(
            ...queries.flatMap((t) => [
              sql`instr(${annictWorks.title}, ${t}) > 0`,
              sql`instr(${annictWorks.titleKana}, ${t}) > 0`,
              sql`instr(${annictWorks.titleEn}, ${t}) > 0`,
            ]),
          ),
        )
        // 同名・類似タイトルが大量にヒットしたとき、人気作品を優先的に
        // プールへ残す（打ち切りで本命が溢れにくいように）。
        .orderBy(desc(annictWorks.watchersCount))
        .limit(LOCAL_SEARCH_MAX_ROWS);
    } catch (err) {
      // ローカル検索は補助なので、D1 の失敗で照合全体を止めない。
      // null（キャッシュ無し扱い）を返し、core が Annict 検索に回す。
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "danime_local_search_failed",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return null;
    }

    return rows.map((row): DanimeAnnictWork => ({
      annictWorkId: row.annictWorkId,
      nodeId: row.nodeId,
      title: row.title,
      titleKana: row.titleKana,
      titleEn: row.titleEn,
      seasonName: row.seasonName,
      seasonYear: row.seasonYear,
      imageUrl: row.imageUrl,
      malAnimeId: row.malAnimeId,
    }));
  };
}
