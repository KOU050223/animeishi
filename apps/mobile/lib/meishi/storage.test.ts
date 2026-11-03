import AsyncStorage from "@react-native-async-storage/async-storage";
import { addCard } from "./library";
import {
  clearMeishiDocument,
  loadMeishiDocument,
  loadMeishiLibrary,
  saveMeishiLibrary,
  updateMeishiLibrary,
} from "./storage";
import type { MeishiDocument, MeishiLibrary } from "./types";

const sampleDoc: MeishiDocument = {
  version: 1,
  canvas: {
    aspectRatio: 1.6,
    background: { kind: "solid", color: "#ffffff" },
  },
  elements: [],
};

const sampleLibrary: MeishiLibrary = {
  version: 1,
  cards: [
    {
      id: "card-1",
      name: "名刺 1",
      document: sampleDoc,
      createdAt: 1000,
      updatedAt: 1000,
    },
  ],
  defaultCardId: "card-1",
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("loadMeishiLibrary", () => {
  it("何も保存されていなければ null", async () => {
    expect(await loadMeishiLibrary()).toBeNull();
  });

  it("保存済みライブラリをそのまま返す", async () => {
    await AsyncStorage.setItem(
      "meishi-library:v1",
      JSON.stringify(sampleLibrary),
    );
    expect(await loadMeishiLibrary()).toEqual(sampleLibrary);
  });

  it("ライブラリが無く従来の単一ドキュメントだけあるとき、既定カードとして移行して返す", async () => {
    await AsyncStorage.setItem("meishi-document:v1", JSON.stringify(sampleDoc));
    const lib = await loadMeishiLibrary();
    expect(lib).not.toBeNull();
    expect(lib!.cards).toHaveLength(1);
    expect(lib!.cards[0].document).toEqual(sampleDoc);
    expect(lib!.defaultCardId).toBe(lib!.cards[0].id);
  });

  it("移行は初回読み込みで確定され、以後の読み込みでも同じカード ID を返す", async () => {
    await AsyncStorage.setItem("meishi-document:v1", JSON.stringify(sampleDoc));
    const first = await loadMeishiLibrary();
    const firstId = first!.cards[0].id;

    // 移行がライブラリとして書き込まれ、レガシーは書き込み後に消えている
    expect(await AsyncStorage.getItem("meishi-document:v1")).toBeNull();
    const raw = await AsyncStorage.getItem("meishi-library:v1");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).cards[0].id).toBe(firstId);

    const second = await loadMeishiLibrary();
    expect(second!.cards[0].id).toBe(firstId);
  });

  it("同時に読み込んでも移行カードの ID は一致する", async () => {
    await AsyncStorage.setItem("meishi-document:v1", JSON.stringify(sampleDoc));
    const [a, b] = await Promise.all([
      loadMeishiLibrary(),
      loadMeishiLibrary(),
    ]);
    expect(a!.cards[0].id).toBe(b!.cards[0].id);
  });

  it("ライブラリとレガシーが両方あるときはライブラリを優先する", async () => {
    await AsyncStorage.setItem("meishi-document:v1", JSON.stringify(sampleDoc));
    await AsyncStorage.setItem(
      "meishi-library:v1",
      JSON.stringify(sampleLibrary),
    );
    expect(await loadMeishiLibrary()).toEqual(sampleLibrary);
  });

  it("壊れた JSON は null", async () => {
    await AsyncStorage.setItem("meishi-library:v1", "{not json");
    expect(await loadMeishiLibrary()).toBeNull();
  });

  it("version が違うデータは null", async () => {
    await AsyncStorage.setItem(
      "meishi-library:v1",
      JSON.stringify({ version: 2, cards: [], defaultCardId: null }),
    );
    expect(await loadMeishiLibrary()).toBeNull();
  });
});

describe("saveMeishiLibrary", () => {
  it("ライブラリを保存し、レガシーキーを取り除く", async () => {
    await AsyncStorage.setItem("meishi-document:v1", JSON.stringify(sampleDoc));
    await saveMeishiLibrary(sampleLibrary);

    const raw = await AsyncStorage.getItem("meishi-library:v1");
    expect(JSON.parse(raw!)).toEqual(sampleLibrary);
    expect(await AsyncStorage.getItem("meishi-document:v1")).toBeNull();
  });
});

describe("updateMeishiLibrary", () => {
  it("直前の保存結果を読んでから更新するので、await しない連続更新でも変更が消えない", async () => {
    await AsyncStorage.setItem(
      "meishi-library:v1",
      JSON.stringify(sampleLibrary),
    );

    // 複製→追加を待たずに連続実行しても両方が保存に残る
    const [r1, r2] = await Promise.all([
      updateMeishiLibrary((lib) => ({
        library: addCard(lib, sampleDoc).library,
        result: "first",
      })),
      updateMeishiLibrary((lib) => ({
        library: addCard(lib, sampleDoc).library,
        result: "second",
      })),
    ]);

    expect(r1.result).toBe("first");
    expect(r2.result).toBe("second");
    expect(r2.library.cards).toHaveLength(3);

    const stored = await loadMeishiLibrary();
    expect(stored!.cards).toHaveLength(3);
  });

  it("保存先が空のときは空ライブラリから始める", async () => {
    const out = await updateMeishiLibrary((lib) => ({
      library: addCard(lib, sampleDoc).library,
      result: undefined,
    }));
    expect(out.library.cards).toHaveLength(1);
    expect(out.library.defaultCardId).toBe(out.library.cards[0].id);
  });
});

describe("clearMeishiDocument", () => {
  it("レガシーとライブラリの両方を消す", async () => {
    await AsyncStorage.setItem("meishi-document:v1", JSON.stringify(sampleDoc));
    await AsyncStorage.setItem(
      "meishi-library:v1",
      JSON.stringify(sampleLibrary),
    );
    await clearMeishiDocument();
    expect(await AsyncStorage.getItem("meishi-document:v1")).toBeNull();
    expect(await AsyncStorage.getItem("meishi-library:v1")).toBeNull();
  });
});

describe("loadMeishiDocument", () => {
  it("従来の読み出しはレガシーキーを見る（移行用に残す）", async () => {
    await AsyncStorage.setItem("meishi-document:v1", JSON.stringify(sampleDoc));
    expect(await loadMeishiDocument()).toEqual(sampleDoc);
  });
});
