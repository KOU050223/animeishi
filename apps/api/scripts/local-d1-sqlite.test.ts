import { describe, expect, it, vi } from "vitest";
import {
  d1ObjectIdFromName,
  lazyLocalD1DbCredentials,
  localD1DatabaseIds,
  resolveLocalD1Sqlite,
} from "./local-d1-sqlite.mjs";

// d1ObjectIdFromName のゴールデン値は、実際に wrangler dev が生成した
// .wrangler/state/v3/d1/miniflare-D1DatabaseObject/<id>.sqlite の
// ファイル名と照合済み（issue #763）。

describe("d1ObjectIdFromName", () => {
  it("database_id から workerd の idFromName と同じオブジェクト ID を計算する", () => {
    expect(d1ObjectIdFromName("ae2dfdcb-2d1e-4436-97b4-552c6ca31ede")).toBe(
      "9b36da09929644a2df767112f68046394e2bce9a8949d063c9f47c24c2838a36",
    );
    expect(d1ObjectIdFromName("00000000-0000-0000-0000-000000000000")).toBe(
      "9ba2b04bf514d9facfd57ed57d849e77241a7adc99d1c1545d06688b43d84248",
    );
    expect(d1ObjectIdFromName("a429fdc7-43da-4286-93c7-f946e1b4288e")).toBe(
      "5f20559bb90ed9a7fef2e799e532be059aa19a9e2346abb3d391053f3352e911",
    );
  });
});

describe("localD1DatabaseIds", () => {
  it("wrangler.toml のデフォルト env の d1_databases から database_id を取り出す", () => {
    const config = {
      d1_databases: [
        {
          binding: "DB",
          database_name: "animeishi-db",
          database_id: "00000000-0000-0000-0000-000000000000",
        },
      ],
      env: {
        production: {
          d1_databases: [
            {
              binding: "DB",
              database_name: "animeishi-db",
              database_id: "ae2dfdcb-2d1e-4436-97b4-552c6ca31ede",
            },
          ],
        },
      },
    };

    expect(localD1DatabaseIds(config)).toEqual([
      "00000000-0000-0000-0000-000000000000",
    ]);
  });

  it("d1_databases が無い・空のときは空配列を返す", () => {
    expect(localD1DatabaseIds({})).toEqual([]);
    expect(localD1DatabaseIds({ d1_databases: [] })).toEqual([]);
  });

  it("database_id を持たないエントリは無視する", () => {
    const config = {
      d1_databases: [
        { binding: "DB", database_name: "animeishi-db" },
        {
          binding: "OTHER",
          database_id: "a429fdc7-43da-4286-93c7-f946e1b4288e",
        },
      ],
    };

    expect(localD1DatabaseIds(config)).toEqual([
      "a429fdc7-43da-4286-93c7-f946e1b4288e",
    ]);
  });
});

describe("resolveLocalD1Sqlite", () => {
  const EXPECTED =
    "9ba2b04bf514d9facfd57ed57d849e77241a7adc99d1c1545d06688b43d84248.sqlite";

  it("複数の .sqlite があっても今の設定の database_id に対応するファイルを選ぶ", () => {
    const files = [
      "9b36da09929644a2df767112f68046394e2bce9a8949d063c9f47c24c2838a36.sqlite",
      EXPECTED,
      "metadata.sqlite",
      `${EXPECTED}-shm`,
      `${EXPECTED}-wal`,
    ];

    expect(
      resolveLocalD1Sqlite(["00000000-0000-0000-0000-000000000000"], files),
    ).toBe(EXPECTED);
  });

  it("対応するファイルが無いときはローカル D1 の作成方法を促すエラーを投げる", () => {
    expect(() =>
      resolveLocalD1Sqlite(
        ["00000000-0000-0000-0000-000000000000"],
        [
          "9b36da09929644a2df767112f68046394e2bce9a8949d063c9f47c24c2838a36.sqlite",
          "metadata.sqlite",
        ],
      ),
    ).toThrow(/db:migrate:local/);
  });

  it("database_id の一覧が空のときは設定不備のエラーを投げる", () => {
    expect(() => resolveLocalD1Sqlite([], [EXPECTED])).toThrow(/d1_databases/);
  });

  it("対応するファイルが複数あるときは絞り込めない旨のエラーを投げる", () => {
    const files = [
      "9ba2b04bf514d9facfd57ed57d849e77241a7adc99d1c1545d06688b43d84248.sqlite",
      "5f20559bb90ed9a7fef2e799e532be059aa19a9e2346abb3d391053f3352e911.sqlite",
    ];

    expect(() =>
      resolveLocalD1Sqlite(
        [
          "00000000-0000-0000-0000-000000000000",
          "a429fdc7-43da-4286-93c7-f946e1b4288e",
        ],
        files,
      ),
    ).toThrow(/1つに絞れません/);
  });
});

describe("lazyLocalD1DbCredentials", () => {
  const DATABASE_ID = "00000000-0000-0000-0000-000000000000";
  const EXPECTED =
    "9ba2b04bf514d9facfd57ed57d849e77241a7adc99d1c1545d06688b43d84248.sqlite";

  it("SQLite ファイルが無くても生成時はエラーにならず、url アクセス時にエラーを投げる", () => {
    const credentials = lazyLocalD1DbCredentials(
      [DATABASE_ID],
      "d1-dir",
      () => [],
    );

    expect(() => credentials.url).toThrow(/db:migrate:local/);
  });

  it("url アクセス時にファイル一覧を取得して SQLite ファイルへのパスを返す", () => {
    const listFiles = vi.fn(() => [EXPECTED]);
    const credentials = lazyLocalD1DbCredentials(
      [DATABASE_ID],
      "d1-dir",
      listFiles,
    );

    expect(listFiles).not.toHaveBeenCalled();
    expect(credentials.url).toBe(`d1-dir/${EXPECTED}`);
    expect(listFiles).toHaveBeenCalledTimes(1);
  });
});
