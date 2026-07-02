import { MEISHI_ASPECT_RATIO, newId } from "./defaults";
import type { MeishiDocument, MeishiElement, TextElement } from "./types";

export type MeishiTemplate = {
  id: string;
  name: string;
  emoji: string;
  build: () => MeishiDocument;
};

function usernameText(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: newId(),
    type: "text",
    transform: { x: 0.08, y: 0.15, width: 0.6, height: 0.15, rotation: 0 },
    text: "ユーザー名",
    source: "username",
    fontSize: 22,
    fontFamily: "notoSansJp",
    fontWeight: "bold",
    fontStyle: "normal",
    color: "#111827",
    align: "left",
    ...overrides,
  };
}

function bioText(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: newId(),
    type: "text",
    transform: { x: 0.08, y: 0.35, width: 0.6, height: 0.15, rotation: 0 },
    text: "自己紹介",
    source: "bio",
    fontSize: 12,
    fontFamily: "notoSansJp",
    fontWeight: "normal",
    fontStyle: "normal",
    color: "#374151",
    align: "left",
    ...overrides,
  };
}

function quoteText(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: newId(),
    type: "text",
    transform: { x: 0.08, y: 0.6, width: 0.6, height: 0.12, rotation: 0 },
    text: "好きなセリフ",
    source: "favoriteQuote",
    fontSize: 12,
    fontFamily: "notoSerifJp",
    fontWeight: "normal",
    fontStyle: "italic",
    color: "#6b7280",
    align: "left",
    ...overrides,
  };
}

function avatarImage(
  overrides: Partial<Extract<MeishiElement, { type: "image" }>> = {},
): MeishiElement {
  return {
    id: newId(),
    type: "image",
    transform: {
      x: 0.75,
      y: 0.15,
      width: 0.18,
      height: 0.18 * MEISHI_ASPECT_RATIO,
      rotation: 0,
    },
    uri: "",
    source: "avatar",
    shape: "circle",
    objectFit: "cover",
    ...overrides,
  };
}

function profileQr(): MeishiElement {
  return {
    id: newId(),
    type: "qr",
    transform: {
      x: 0.75,
      y: 0.6,
      width: 0.2,
      height: 0.2 * MEISHI_ASPECT_RATIO,
      rotation: 0,
    },
    source: "profile",
    data: "",
    fgColor: "#111827",
    bgColor: "#ffffff",
  };
}

function baseDoc(): Omit<MeishiDocument, "elements" | "canvas"> & {
  canvas: MeishiDocument["canvas"];
} {
  return {
    version: 1,
    canvas: {
      aspectRatio: MEISHI_ASPECT_RATIO,
      background: { kind: "solid", color: "#ffffff" },
    },
  };
}

export const MEISHI_TEMPLATES: MeishiTemplate[] = [
  {
    id: "blank",
    name: "白紙",
    emoji: "📄",
    build: () => ({ ...baseDoc(), elements: [] }),
  },
  {
    id: "classic",
    name: "クラシック",
    emoji: "🎴",
    build: () => ({
      ...baseDoc(),
      elements: [
        avatarImage(),
        usernameText(),
        bioText(),
        quoteText(),
        profileQr(),
      ],
    }),
  },
  {
    id: "sunset",
    name: "サンセット",
    emoji: "🌅",
    build: () => {
      const base = baseDoc();
      return {
        ...base,
        canvas: {
          ...base.canvas,
          background: {
            kind: "gradient",
            from: "#ff9a56",
            to: "#ff5f6d",
            angle: 135,
          },
        },
        elements: [
          avatarImage({ shape: "rounded" }),
          usernameText({ color: "#ffffff" }),
          bioText({ color: "#fff1d6" }),
          quoteText({ color: "#fff1d6" }),
          profileQr(),
        ],
      };
    },
  },
  {
    id: "midnight",
    name: "ミッドナイト",
    emoji: "🌙",
    build: () => {
      const base = baseDoc();
      return {
        ...base,
        canvas: {
          ...base.canvas,
          background: {
            kind: "gradient",
            from: "#0f172a",
            to: "#4c1d95",
            angle: 160,
          },
        },
        elements: [
          avatarImage({ shape: "circle" }),
          usernameText({ color: "#f5f3ff", fontStyle: "italic" }),
          bioText({ color: "#c4b5fd" }),
          quoteText({ color: "#a78bfa" }),
          profileQr(),
        ],
      };
    },
  },
  {
    id: "sakura",
    name: "さくら",
    emoji: "🌸",
    build: () => {
      const base = baseDoc();
      return {
        ...base,
        canvas: {
          ...base.canvas,
          background: {
            kind: "gradient",
            from: "#fce7f3",
            to: "#fbcfe8",
            angle: 180,
          },
        },
        elements: [
          avatarImage({ shape: "rounded" }),
          usernameText({ color: "#831843", align: "left" }),
          bioText({ color: "#9d174d" }),
          quoteText({ color: "#be185d" }),
          profileQr(),
        ],
      };
    },
  },
];

export function getTemplate(id: string): MeishiTemplate | undefined {
  return MEISHI_TEMPLATES.find((t) => t.id === id);
}

export function buildBlankDocument(): MeishiDocument {
  return MEISHI_TEMPLATES[0].build();
}
