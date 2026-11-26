import { newId } from "./defaults";
import type { MeishiCardData, MeishiDocument, MeishiLibrary } from "./types";

// 名刺ライブラリ（複数名刺, issue #427）への純粋な操作群。
// 状態はすべて AsyncStorage 上の MeishiLibrary に対する read-modify-write で
// 行い、永続化は storage.ts が担う。画面・フックはここを経由して触る。

type AddOptions = { id?: string; name?: string; now?: number };

export function emptyLibrary(): MeishiLibrary {
  return { version: 1, cards: [], defaultCardId: null };
}

export function findCard(
  library: MeishiLibrary,
  id: string,
): MeishiCardData | null {
  return library.cards.find((c) => c.id === id) ?? null;
}

export function defaultCard(library: MeishiLibrary): MeishiCardData | null {
  if (!library.defaultCardId) return null;
  return findCard(library, library.defaultCardId);
}

const AUTO_NAME_PATTERN = /^名刺 (\d+)$/;

// 自動命名の連番。削除で抜けた番号を再利用しないよう、
// カード数ではなく既存の最大番号の次を採番する。
export function nextCardName(cards: MeishiCardData[]): string {
  const max = cards.reduce((acc, c) => {
    const m = AUTO_NAME_PATTERN.exec(c.name);
    return m ? Math.max(acc, Number(m[1])) : acc;
  }, 0);
  return `名刺 ${max + 1}`;
}

// カードを追加する。最初の 1 枚は自動で既定になる
// （既存ユーザーの名刺が移行後に既定として残るのと同じ規則）。
export function addCard(
  library: MeishiLibrary,
  document: MeishiDocument,
  options: AddOptions = {},
): { library: MeishiLibrary; card: MeishiCardData } {
  const now = options.now ?? Date.now();
  const card: MeishiCardData = {
    id: options.id ?? newId(),
    name: options.name ?? nextCardName(library.cards),
    document,
    createdAt: now,
    updatedAt: now,
  };
  return {
    card,
    library: {
      ...library,
      cards: [...library.cards, card],
      defaultCardId: library.defaultCardId ?? card.id,
    },
  };
}

// カードを複製する。複製は既定を変えず、「〜のコピー」で命名する。
export function duplicateCard(
  library: MeishiLibrary,
  id: string,
  options: { id?: string; now?: number } = {},
): { library: MeishiLibrary; card: MeishiCardData } | null {
  const source = findCard(library, id);
  if (!source) return null;
  const now = options.now ?? Date.now();
  const card: MeishiCardData = {
    id: options.id ?? newId(),
    name: `${source.name} のコピー`,
    document: source.document,
    createdAt: now,
    updatedAt: now,
  };
  const sourceIndex = library.cards.findIndex((c) => c.id === id);
  const cards = [...library.cards];
  cards.splice(sourceIndex + 1, 0, card);
  return { card, library: { ...library, cards } };
}

// カードを削除する。既定を消した場合は残っている最古のカードを
// 既定に繰り上げる（いちばん最初に作った名刺を「メイン」と見なす）。
export function removeCard(library: MeishiLibrary, id: string): MeishiLibrary {
  const cards = library.cards.filter((c) => c.id !== id);
  if (cards.length === library.cards.length) return library;
  let defaultCardId = library.defaultCardId;
  if (defaultCardId === id) {
    const oldest = cards.reduce<MeishiCardData | null>(
      (acc, c) => (acc === null || c.createdAt < acc.createdAt ? c : acc),
      null,
    );
    defaultCardId = oldest?.id ?? null;
  }
  return { ...library, cards, defaultCardId };
}

export function setDefaultCard(
  library: MeishiLibrary,
  id: string,
): MeishiLibrary {
  if (!findCard(library, id)) return library;
  return { ...library, defaultCardId: id };
}

export function updateCardDocument(
  library: MeishiLibrary,
  id: string,
  document: MeishiDocument,
  options: { now?: number } = {},
): MeishiLibrary {
  const now = options.now ?? Date.now();
  return {
    ...library,
    cards: library.cards.map((c) =>
      c.id === id ? { ...c, document, updatedAt: now } : c,
    ),
  };
}

// 従来の単一ドキュメント（meishi-document:v1）をライブラリへ移行する。
// 既存ユーザーの名刺を消さず、唯一の既定カードとして残す（issue #427）。
export function migrateLegacyDocument(
  document: MeishiDocument,
  options: AddOptions = {},
): MeishiLibrary {
  return addCard(emptyLibrary(), document, options).library;
}
