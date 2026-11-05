// 総選挙（issue #438）の frontmatter → elections / election_candidates
// 行の変換。frontmatter 付き Markdown を D1 に投入するスクリプト群の
// 共有部品（frontmatter-content.mjs）の上に乗る、総選挙固有の検証・
// マッピング。使い方の例は publish-election.mjs を参照。

import {
  frontmatterDateToUnix,
  frontmatterRequiredString,
} from "./frontmatter-content.mjs";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const CANDIDATE_KINDS = ["character", "work"];

// 省略可の文字列 frontmatter 値を取り出す。未指定・null は null、
// 文字列でない値が来たらエラー（YAML で数値化した typo を黙って
// 登録しないため）。
function frontmatterOptionalString(value, { field }) {
  if (value === undefined || value === null) return null;
  return frontmatterRequiredString(value, { field });
}

// 省略可の URL frontmatter 値を取り出す。アプリから画像として読む
// URL のため https:// だけを許可する（event-content.mjs と同じ考え方）。
function frontmatterOptionalHttpsUrl(value, { field }) {
  const url = frontmatterOptionalString(value, { field });
  if (url !== null && !url.startsWith("https://")) {
    throw new Error(`${field} は https:// で始まる URL にしてください: ${url}`);
  }
  return url;
}

// candidates の 1 件を検証して election_candidates の行（id・created_at・
// updated_at を除く）に変換する。position は candidates の並び順。
function buildCandidateRow(candidate, index) {
  const field = `candidates[${index}]`;
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  ) {
    throw new Error(`${field} は - kind: ... の形式で書いてください`);
  }
  const kind = candidate.kind;
  if (!CANDIDATE_KINDS.includes(kind)) {
    throw new Error(
      `${field}.kind は character | work のどちらかにしてください: ${JSON.stringify(kind)}`,
    );
  }
  const annictId = candidate.annict_id;
  if (!Number.isInteger(annictId) || annictId <= 0) {
    throw new Error(
      `${field}.annict_id は正の整数で書いてください: ${JSON.stringify(annictId)}`,
    );
  }
  return {
    kind,
    annict_id: annictId,
    name: frontmatterRequiredString(candidate.name, {
      field: `${field}.name`,
    }),
    image_url: frontmatterOptionalHttpsUrl(candidate.image_url, {
      field: `${field}.image_url`,
    }),
    position: index,
  };
}

/**
 * 検証済み frontmatter と本文から elections 行（created_at / updated_at
 * を除く）と election_candidates 行の配列を組み立てる。
 * 不正な値は Error を投げる。
 * @param {Record<string, unknown>} attributes パース済み frontmatter
 * @param {string} body frontmatter 以降の本文 Markdown
 * @returns {{
 *   election: Record<string, string | number | null>,
 *   candidates: Record<string, string | number | null>[],
 * }}
 */
export function buildElectionRows(attributes, body) {
  const slug = frontmatterRequiredString(attributes.slug, { field: "slug" });
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `slug の形式が正しくありません: ${slug}（小文字英数字とハイフンのみ、先頭は英数字）`,
    );
  }
  const title = frontmatterRequiredString(attributes.title, {
    field: "title",
  });
  const startsAt = frontmatterDateToUnix(attributes.starts_at, {
    field: "starts_at",
    required: true,
  });
  const endsAt = frontmatterDateToUnix(attributes.ends_at, {
    field: "ends_at",
    required: true,
  });
  if (endsAt <= startsAt) {
    throw new Error("ends_at は starts_at より後の日時にしてください");
  }
  const publishedAt = frontmatterDateToUnix(attributes.published_at, {
    field: "published_at",
    required: true,
  });
  const unpublishedAt = frontmatterDateToUnix(attributes.unpublished_at, {
    field: "unpublished_at",
  });
  if (unpublishedAt !== null && unpublishedAt <= publishedAt) {
    throw new Error(
      "unpublished_at は published_at より後の日時にしてください",
    );
  }

  if (!Array.isArray(attributes.candidates)) {
    throw new Error("frontmatter に candidates（候補のリスト）がありません");
  }
  // 投票を成立させるため候補は 2 件以上を必須にする。
  if (attributes.candidates.length < 2) {
    throw new Error("candidates は 2 件以上にしてください");
  }
  const candidates = attributes.candidates.map(buildCandidateRow);
  // (kind, annict_id) の重複は unique 制約に抵触するため投入前に弾く。
  const seen = new Set();
  for (const c of candidates) {
    const key = `${c.kind}:${c.annict_id}`;
    if (seen.has(key)) {
      throw new Error(
        `candidates に重複があります: kind=${c.kind}, annict_id=${c.annict_id}`,
      );
    }
    seen.add(key);
  }

  return {
    election: {
      slug,
      title,
      // 説明文は省略可（お題と候補だけの登録を許す）。空本文は NULL。
      body: body.trim() === "" ? null : body,
      cover_image_url: frontmatterOptionalHttpsUrl(attributes.cover_image_url, {
        field: "cover_image_url",
      }),
      starts_at: startsAt,
      ends_at: endsAt,
      published_at: publishedAt,
      unpublished_at: unpublishedAt,
    },
    candidates,
  };
}
