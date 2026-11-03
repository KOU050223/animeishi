import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearMeishiDocument,
  loadMeishiDocument,
  loadMeishiLibrary,
  saveMeishiLibrary,
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
