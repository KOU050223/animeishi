import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { ElementRenderer } from "@/components/meishi/elements/ElementRenderer";
import type {
  AchievementBadgeElement,
  AnimeCollageElement,
  MeishiRenderContext,
  TextElement,
} from "@/lib/meishi/types";

// useTranslation の t() は ja のときキーがそのまま文言になる設計のため、
// キー返し + {{name}} 補間だけの軽量モックで表示結果を再現する
// （@/lib/i18n 実体を読み込むと初期化コストで既存テストが遅くなる）。
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      Object.entries(opts ?? {}).reduce(
        (s, [k, v]) => s.replaceAll(`{{${k}}}`, String(v)),
        key,
      ),
  }),
}));

const ctx: MeishiRenderContext = {
  profile: {
    username:
      "長いユーザー名である寿限無寿限無、五劫のすり切れ、海砂利水魚の水行末 雲来末 風来末、食う寝るところに住むところ、やぶらこうじのぶらこうじ、パイポパイポ パイポのシューリンガン、シューリンガンのグーリンダイ、グーリンダイのポンポコピーのポンポコナーの、長久命の長助",
  },
};

const textElement: TextElement = {
  id: "text-1",
  type: "text",
  transform: { x: 0, y: 0, width: 0.5, height: 0.1, rotation: 0 },
  text: "テキスト",
  source: "username",
  fontSize: 24,
  fontFamily: "system",
  fontWeight: "bold",
  fontStyle: "normal",
  color: "#111827",
  align: "left",
};

const collageElement: AnimeCollageElement = {
  id: "collage-1",
  type: "animeCollage",
  transform: { x: 0, y: 0, width: 0.5, height: 0.3, rotation: 0 },
  cols: 3,
  rows: 1,
  sortBy: "recent",
  limit: 8,
  gap: 0.02,
};

const collageCtx: MeishiRenderContext = {
  profile: {},
  // 旧ドキュメント用フォールバック（自動時はこれを見る）
  animeCollageImages: ["https://img.example/auto-1.jpg"],
  animeLists: {
    watchHistory: [
      "https://img.example/watched-1.jpg",
      "https://img.example/watched-2.jpg",
    ],
    favorites: ["https://img.example/fav-1.jpg"],
    byState: {
      WATCHED: ["https://img.example/watched-1.jpg"],
      WANNA_WATCH: ["https://img.example/wanna-1.jpg"],
    },
  },
};

// コラージュ内で実際に描画された <Image> の uri 一覧を取り出す。
// RNTL 14 では UNSAFE_queryAllByType が無いため、ホストツリーを
// container.queryAll で type="Image" に絞る。
async function renderedUris(
  element: AnimeCollageElement,
  renderCtx: MeishiRenderContext,
): Promise<string[]> {
  await render(
    <ElementRenderer
      element={element}
      ctx={renderCtx}
      boxWidth={300}
      boxHeight={100}
      renderScale={1}
    />,
  );
  return screen.container
    .queryAll((node) => node.type === "Image")
    .map((img) => img.props.source.uri);
}

describe("ElementRenderer", () => {
  it("テキストの fontSize を renderScale に合わせて縮小する", async () => {
    await render(
      <ElementRenderer
        element={textElement}
        ctx={ctx}
        boxWidth={200}
        boxHeight={80}
        renderScale={0.5}
      />,
    );

    const text = screen.container.queryAll((node) => node.type === "Text")[0];
    const style = StyleSheet.flatten(text.props.style);

    expect(style.fontSize).toBe(12);
  });

  it("コラージュ: listSource/state 未設定は従来の animeCollageImages を使う", async () => {
    expect(await renderedUris(collageElement, collageCtx)).toEqual([
      "https://img.example/auto-1.jpg",
    ]);
  });

  it("コラージュ: listSource=favorites はお気に入り画像を使う", async () => {
    const el: AnimeCollageElement = {
      ...collageElement,
      listSource: "favorites",
    };
    expect(await renderedUris(el, collageCtx)).toEqual([
      "https://img.example/fav-1.jpg",
    ]);
  });

  it("コラージュ: listSource=watchHistory は視聴履歴画像を使う", async () => {
    const el: AnimeCollageElement = {
      ...collageElement,
      listSource: "watchHistory",
    };
    expect(await renderedUris(el, collageCtx)).toEqual([
      "https://img.example/watched-1.jpg",
      "https://img.example/watched-2.jpg",
    ]);
  });

  it("コラージュ: state 指定時はステータス別リストを使う", async () => {
    const el: AnimeCollageElement = {
      ...collageElement,
      state: "WANNA_WATCH",
    };
    expect(await renderedUris(el, collageCtx)).toEqual([
      "https://img.example/wanna-1.jpg",
    ]);
  });

  it("コラージュ: state 指定で該当ステータスの作品がなければ空になる", async () => {
    // legacy へフォールバックすると別ステータスの作品が混入するため
    const el: AnimeCollageElement = {
      ...collageElement,
      state: "ON_HOLD",
    };
    expect(await renderedUris(el, collageCtx)).toEqual([]);
  });

  it("コラージュ: animeLists を持たない旧コンテキストでは animeCollageImages にフォールバックする", async () => {
    const el: AnimeCollageElement = {
      ...collageElement,
      listSource: "favorites",
    };
    const legacyCtx: MeishiRenderContext = {
      profile: {},
      animeCollageImages: ["https://img.example/auto-1.jpg"],
    };
    expect(await renderedUris(el, legacyCtx)).toEqual([
      "https://img.example/auto-1.jpg",
    ]);
  });

  describe("実績バッジ（issue #415）", () => {
    const badgeElement: AchievementBadgeElement = {
      id: "badge-1",
      type: "achievementBadge",
      transform: { x: 0, y: 0, width: 0.4, height: 0.1, rotation: 0 },
      kind: "watch_count",
      fontSize: 16,
      fontWeight: "bold",
      fontFamily: "system",
      color: "#ffffff",
      bgColor: "#d97706",
    };
    const badgeCtx: MeishiRenderContext = {
      profile: {},
      achievements: [
        {
          id: "watch_count_10",
          kind: "watch_count",
          threshold: 10,
          earned: true,
        },
        {
          id: "watch_count_50",
          kind: "watch_count",
          threshold: 50,
          earned: true,
        },
        {
          id: "watch_count_100",
          kind: "watch_count",
          threshold: 100,
          earned: false,
        },
      ],
    };

    async function renderedText(
      element: AchievementBadgeElement,
      renderCtx: MeishiRenderContext,
    ) {
      await render(
        <ElementRenderer
          element={element}
          ctx={renderCtx}
          boxWidth={200}
          boxHeight={40}
          renderScale={1}
        />,
      );
      return screen.container
        .queryAll((node) => node.type === "Text")
        .map((n) => n.props.children)
        .join("");
    }

    it("獲得済みの最高段の名前を表示する", async () => {
      expect(await renderedText(badgeElement, badgeCtx)).toBe("視聴 50 作品");
    });

    it("未獲得なら（未獲得）付きで表示する", async () => {
      const ctx: MeishiRenderContext = {
        profile: {},
        achievements: [
          {
            id: "watch_count_10",
            kind: "watch_count",
            threshold: 10,
            earned: false,
          },
        ],
      };
      expect(await renderedText(badgeElement, ctx)).toBe(
        "視聴 10 作品（未獲得）",
      );
    });

    it("実績データが無いコンテキストでも描画できる", async () => {
      expect(
        await renderedText(
          { ...badgeElement, kind: "season_completion" },
          { profile: {} },
        ),
      ).toBe("今期完走（未獲得）");
    });
  });
});
