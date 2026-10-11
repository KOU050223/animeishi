import { describe, expect, it } from "vitest";
import { health } from "@/routes/health";

describe("GET /health", () => {
  it("status / timestamp とバインディングのバージョン情報を返す", async () => {
    const res = await health.request(
      "/",
      {},
      {
        ENVIRONMENT: "preview",
        COMMIT_SHA: "abc1234deadbeef",
        CF_VERSION_METADATA: { id: "version-1", tag: "", timestamp: "0" },
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
    expect(body.environment).toBe("preview");
    expect(body.commitSha).toBe("abc1234deadbeef");
    expect(body.versionId).toBe("version-1");
  });

  it("バージョン系バインディング未設定時は null を返す", async () => {
    const res = await health.request("/", {}, {});

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.environment).toBeNull();
    expect(body.commitSha).toBeNull();
    expect(body.versionId).toBeNull();
  });
});
