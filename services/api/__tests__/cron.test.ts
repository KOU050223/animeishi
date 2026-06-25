import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { env } from "cloudflare:workers";
import { setupTestDb } from "./helpers/setup-db";
import { animeTitles } from "@/db/schema";
import { runAnimeSync } from "@/cron/anime-sync";
import { runSeasonSync } from "@/cron/season-sync";
import { handleScheduled, ANIME_SYNC_CRON, SEASON_SYNC_CRON } from "@/cron";
import { fetchFromShobocal } from "@/cron/source";
import type { AnimeSyncInput } from "@/repository/animeSyncRepo";

type TestBindings = {
  DB: D1Database;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ZONE_ID?: string;
};

const SAMPLE: AnimeSyncInput[] = [
  {
    sourceId: "shobocal:1",
    title: "進撃の巨人",
    titleReading: "しんげきのきょじん",
    titleEnglish: "Attack on Titan",
    year: 2013,
    season: "spring",
    genres: ["action"],
    thumbnailUrl: null,
  },
  {
    sourceId: "shobocal:2",
    title: "鬼滅の刃",
    titleReading: "きめつのやいば",
    titleEnglish: "Demon Slayer",
    year: 2019,
    season: "spring",
    genres: ["action"],
    thumbnailUrl: null,
  },
];

describe("cron: anime-sync", () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>;
  let bindings: TestBindings;

  beforeEach(async () => {
    db = await setupTestDb(env.DB);
    bindings = { DB: env.DB };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("外部ソースのデータを D1 に新規挿入する", async () => {
    const source = vi.fn(async () => SAMPLE);
    const result = await runAnimeSync(bindings, source);

    expect(source).toHaveBeenCalledOnce();
    expect(result.fetched).toBe(2);
    expect(result.sync).toEqual({ inserted: 2, updated: 0, skipped: 0 });

    const rows = await db.query.animeTitles.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.title).sort()).toEqual(["進撃の巨人", "鬼滅の刃"]);
  });

  it("既存と同一データは skipped、変更があれば updated になる", async () => {
    await runAnimeSync(bindings, async () => SAMPLE);

    // 1 件はそのまま、1 件は英題を変更
    const modified: AnimeSyncInput[] = [
      SAMPLE[0]!,
      { ...SAMPLE[1]!, titleEnglish: "Kimetsu no Yaiba" },
    ];
    const result = await runAnimeSync(bindings, async () => modified);

    expect(result.sync).toEqual({ inserted: 0, updated: 1, skipped: 1 });

    const updated = await db.query.animeTitles.findFirst({
      where: (t, { eq }) => eq(t.title, "鬼滅の刃"),
    });
    expect(updated?.titleEnglish).toBe("Kimetsu no Yaiba");
  });

  it("sourceId が同じならタイトル変更でも新規行を作らず更新する", async () => {
    await runAnimeSync(bindings, async () => SAMPLE);

    // sourceId は据え置きでタイトルだけ改名された場合
    const renamed: AnimeSyncInput[] = [
      { ...SAMPLE[0]!, title: "進撃の巨人 The Final Season" },
      SAMPLE[1]!,
    ];
    const result = await runAnimeSync(bindings, async () => renamed);

    expect(result.sync).toEqual({ inserted: 0, updated: 1, skipped: 1 });

    const rows = await db.query.animeTitles.findMany();
    // 行が増えていない（title をキーにしていた頃は 3 件になってしまっていた）
    expect(rows).toHaveLength(2);
    const renamedRow = rows.find((r) => r.sourceId === "shobocal:1");
    expect(renamedRow?.title).toBe("進撃の巨人 The Final Season");
  });

  it("sourceId 列追加前の既存行（source_id=NULL）に初回同期で sourceId を backfill する", async () => {
    // #43 時代に title キーで投入された既存行を再現（source_id は NULL）
    const now = new Date();
    await db.insert(animeTitles).values({
      title: "進撃の巨人",
      titleReading: "しんげきのきょじん",
      titleEnglish: "Attack on Titan",
      year: 2013,
      season: "spring",
      genres: ["action"],
      thumbnailUrl: null,
      createdAt: now,
      updatedAt: now,
    });

    // 同じ作品が sourceId 付きで流れてくる初回同期
    const result = await runAnimeSync(bindings, async () => [SAMPLE[0]!]);

    // 重複行を作らず、既存行へ sourceId を付与（update）する
    expect(result.sync).toEqual({ inserted: 0, updated: 1, skipped: 0 });

    const rows = await db.query.animeTitles.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sourceId).toBe("shobocal:1");
  });

  it("sourceId を持たない入力は title をフォールバックキーにする", async () => {
    const manual: AnimeSyncInput[] = [
      {
        sourceId: null,
        title: "手動投入作品",
        titleReading: null,
        titleEnglish: null,
        year: 2024,
        season: "winter",
        genres: null,
        thumbnailUrl: null,
      },
    ];
    const first = await runAnimeSync(bindings, async () => manual);
    expect(first.sync.inserted).toBe(1);

    // 同じ title で再実行しても重複しない（title フォールバックで突き合わせ）
    const second = await runAnimeSync(bindings, async () => manual);
    expect(second.sync).toEqual({ inserted: 0, updated: 0, skipped: 1 });

    const rows = await db.query.animeTitles.findMany();
    expect(rows).toHaveLength(1);
  });

  it("変更が無ければ Cache Purge を呼ばない", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await runAnimeSync(bindings, async () => SAMPLE); // 1 回目: insert
    fetchSpy.mockClear();

    // 2 回目: 同一データなので skipped のみ
    const result = await runAnimeSync(bindings, async () => SAMPLE);
    expect(result.sync.inserted).toBe(0);
    expect(result.sync.updated).toBe(0);
    expect(result.purge.zonePurged).toBe(false);
    // Cloudflare API への purge_cache 呼び出しが無いこと
    const purgeCalls = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes("purge_cache"),
    );
    expect(purgeCalls).toHaveLength(0);
  });

  it("認証情報がある場合、変更があれば Cloudflare Cache Purge を送信する", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ success: true })));

    const result = await runAnimeSync(
      { DB: env.DB, CLOUDFLARE_API_TOKEN: "token", CLOUDFLARE_ZONE_ID: "zone" },
      async () => SAMPLE,
    );

    expect(result.purge.zonePurged).toBe(true);
    const purgeCall = fetchSpy.mock.calls.find((c) =>
      String(c[0]).includes("/zones/zone/purge_cache"),
    );
    expect(purgeCall).toBeDefined();
    const init = purgeCall![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer token",
    );
  });
});

describe("cron: season-sync", () => {
  let bindings: TestBindings;

  beforeEach(async () => {
    await setupTestDb(env.DB);
    bindings = { DB: env.DB };
  });

  it("現在シーズンを算出してソースに渡し、同期する", async () => {
    const source = vi.fn(async () => [SAMPLE[0]!]);
    // 2026-04-15 = spring
    const result = await runSeasonSync(
      bindings,
      source,
      new Date("2026-04-15T00:00:00Z"),
    );

    expect(source).toHaveBeenCalledWith({ year: 2026, season: "spring" });
    expect(result.year).toBe(2026);
    expect(result.season).toBe("spring");
    expect(result.sync.inserted).toBe(1);
  });
});

describe("cron: handleScheduled ディスパッチ", () => {
  beforeEach(async () => {
    await setupTestDb(env.DB);
    // ディスパッチ配線の確認が目的なので、外部ソース（しょぼいカレンダー）への
    // 実ネットワークアクセスは空配列を返すスタブに置き換える。
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ Titles: {} })),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("anime-sync の cron 式で全件同期が走る", async () => {
    await expect(
      handleScheduled({ cron: ANIME_SYNC_CRON }, { DB: env.DB }),
    ).resolves.toBeUndefined();
  });

  it("season-sync の cron 式でシーズン同期が走る", async () => {
    await expect(
      handleScheduled({ cron: SEASON_SYNC_CRON }, { DB: env.DB }),
    ).resolves.toBeUndefined();
  });
});

describe("source: fetchFromShobocal の季節フィルタ", () => {
  // しょぼいカレンダー TitleLookup を模した応答（spring/2026 と fall/2025 が混在）
  const SHOBOCAL_PAYLOAD = {
    Titles: {
      "1": {
        TID: "1",
        Title: "2026春アニメ",
        TitleYomi: "",
        TitleEN: "",
        FirstYear: "2026",
        FirstMonth: "4", // spring
      },
      "2": {
        TID: "2",
        Title: "2025秋アニメ",
        TitleYomi: "",
        TitleEN: "",
        FirstYear: "2025",
        FirstMonth: "10", // fall
      },
    },
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("year/season 未指定なら全件返す", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(SHOBOCAL_PAYLOAD)),
    );
    const all = await fetchFromShobocal();
    expect(all).toHaveLength(2);
  });

  it("year/season 指定でその条件の作品だけに絞り込む", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(SHOBOCAL_PAYLOAD)),
    );
    const spring = await fetchFromShobocal({ year: 2026, season: "spring" });
    expect(spring).toHaveLength(1);
    expect(spring[0]!.title).toBe("2026春アニメ");
    expect(spring[0]!.sourceId).toBe("shobocal:1");
  });
});
