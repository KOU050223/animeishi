import { describe, expect, it } from "vitest";
import { guestCtaHref } from "./layout";
import {
  buildSharedTierListHtml,
  buildSharedWatchHistoryHtml,
  buildSharedWorkListHtml,
  notFoundHtml,
} from "./service";

const REQUEST_URL = "https://animeishi-api.uomi.dev/share/tier-lists/tok";
const CANONICAL_URL = "https://animeishi.uomi.dev/share/tier-lists/tok";
const TIERS_JSON = JSON.stringify([{ key: "S", label: "S", color: "#ff0000" }]);

function ctaHref(html: string): string | undefined {
  const match = /<div class="guest-cta"><a href="([^"]*)"/.exec(html);
  return match?.[1]?.replaceAll("&amp;", "&");
}

describe("共有ページの登録 CTA（issue #217）", () => {
  it("guestCtaHref: canonical と同じオリジンの新規登録画面へ入口付きで送る", () => {
    expect(guestCtaHref(CANONICAL_URL, "share_tier_list")).toBe(
      "https://animeishi.uomi.dev/sign-up?from=share_tier_list",
    );
  });

  it("各共有ページが入口ごとの CTA を下部固定で出し、本文に余白を取る", () => {
    const pages = [
      {
        source: "share_tier_list",
        label: "あなたも Tier 表を作る",
        html: buildSharedTierListHtml(
          {
            kind: "season",
            title: "春",
            description: null,
            season: "2026-spring",
            tiersJson: TIERS_JSON,
            ownerUsername: "owner",
            items: [],
          },
          REQUEST_URL,
          CANONICAL_URL,
        ),
      },
      {
        source: "share_custom_tier_list",
        label: "あなたも Tier 表を作る",
        html: buildSharedTierListHtml(
          {
            kind: "custom",
            title: "自由",
            description: null,
            tiersJson: TIERS_JSON,
            ownerUsername: "owner",
            items: [],
          },
          REQUEST_URL,
          CANONICAL_URL,
        ),
      },
      {
        source: "share_character_tier_list",
        label: "あなたも Tier 表を作る",
        html: buildSharedTierListHtml(
          {
            kind: "character",
            workTitle: "作品",
            title: "キャラ",
            description: null,
            tiersJson: TIERS_JSON,
            ownerUsername: "owner",
            items: [],
          },
          REQUEST_URL,
          CANONICAL_URL,
        ),
      },
      {
        source: "share_work_list",
        label: "あなたも作品リストを作る",
        html: buildSharedWorkListHtml(
          {
            title: "リスト",
            description: null,
            ownerUsername: "owner",
            items: [],
          },
          REQUEST_URL,
          CANONICAL_URL,
        ),
      },
      {
        source: "share_watch_history",
        label: "あなたも視聴履歴を記録する",
        html: buildSharedWatchHistoryHtml(
          { ownerUsername: "owner", items: [] },
          REQUEST_URL,
          CANONICAL_URL,
        ),
      },
    ];

    for (const { source, label, html } of pages) {
      expect({ source, href: ctaHref(html) }).toEqual({
        source,
        href: `https://animeishi.uomi.dev/sign-up?from=${source}`,
      });
      expect(html).toContain(`>${label}</a>`);
      expect(html).toContain('<body class="has-cta">');
    }
  });

  it("無効な共有リンクのページには CTA を出さない", () => {
    const html = notFoundHtml();
    expect(ctaHref(html)).toBeUndefined();
    expect(html).not.toContain('class="has-cta"');
  });
});
