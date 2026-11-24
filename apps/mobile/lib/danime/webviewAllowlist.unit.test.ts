import { describe, expect, it } from "vitest";
import { isDanimeWebViewUrlAllowed } from "./webviewAllowlist";

describe("isDanimeWebViewUrlAllowed", () => {
  it("dアニメストアのページは許可する", () => {
    expect(
      isDanimeWebViewUrlAllowed(
        "https://animestore.docomo.ne.jp/animestore/mpa_hst_pc?workType=0",
      ),
    ).toBe(true);
    expect(
      isDanimeWebViewUrlAllowed(
        "https://animestore.docomo.ne.jp/animestore/ci?workId=99999",
      ),
    ).toBe(true);
  });

  it("dアカウント認証で遷移する docomo のホストは許可する", () => {
    // id.smt: OIDC 認可、cfg.smt: ログインフォーム・2段階認証
    expect(
      isDanimeWebViewUrlAllowed(
        "https://id.smt.docomo.ne.jp/cgi8/touchtown/oidc/authorizactn?client_id=x",
      ),
    ).toBe(true);
    expect(
      isDanimeWebViewUrlAllowed(
        "https://cfg.smt.docomo.ne.jp/authx/cgi/baseauth?clientid=x",
      ),
    ).toBe(true);
  });

  it("dアニメ・docomo 認証以外のドメインは許可しない", () => {
    expect(isDanimeWebViewUrlAllowed("https://example.com/")).toBe(false);
    expect(isDanimeWebViewUrlAllowed("https://www.docomo.ne.jp/")).toBe(false);
  });

  it("http や docomo に似せた別ドメインは許可しない", () => {
    expect(
      isDanimeWebViewUrlAllowed(
        "http://animestore.docomo.ne.jp/animestore/mpa_hst_pc",
      ),
    ).toBe(false);
    expect(
      isDanimeWebViewUrlAllowed("https://animestore.docomo.ne.jp.evil.com/"),
    ).toBe(false);
    expect(
      isDanimeWebViewUrlAllowed("https://smt.docomo.ne.jp.evil.com/"),
    ).toBe(false);
  });

  it("userinfo 埋め込み・末尾ドットの偽装は許可しない", () => {
    // https://許可ホスト@evil.com/ は実際の遷移先が evil.com になる
    expect(
      isDanimeWebViewUrlAllowed("https://animestore.docomo.ne.jp@evil.com/"),
    ).toBe(false);
    expect(
      isDanimeWebViewUrlAllowed("https://id.smt.docomo.ne.jp@evil.com/"),
    ).toBe(false);
    // 末尾ドット付き FQDN は許可ホストと一致扱いしない（保守的にブロック）
    expect(isDanimeWebViewUrlAllowed("https://animestore.docomo.ne.jp./")).toBe(
      false,
    );
  });

  it("ポート指定つきの許可ホストは許可する", () => {
    expect(
      isDanimeWebViewUrlAllowed(
        "https://animestore.docomo.ne.jp:443/animestore/mpa_hst_pc",
      ),
    ).toBe(true);
  });

  it("WebView 内部の about:blank は許可し、その他のスキームは許可しない", () => {
    expect(isDanimeWebViewUrlAllowed("about:blank")).toBe(true);
    expect(isDanimeWebViewUrlAllowed("tel:0120000000")).toBe(false);
    expect(isDanimeWebViewUrlAllowed("data:text/html,eA==")).toBe(false);
  });
});
