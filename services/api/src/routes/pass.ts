import { Hono } from "hono";
import type { Context } from "hono";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { authorizedDb } from "@/repository/authorizedDb";
import { createDb } from "@/db/client";
import { buildMeishiPassJson } from "@/lib/pass/buildPassJson";

// Apple Wallet 用の Pass Type ID / Team ID / .p12(base64) は環境変数で受け取る。
// 未設定なら .pkpass 署名は行わず 501 を返す（骨組み実装のため）。
type PassBindings = Omit<AuthEnv["Bindings"], "DB"> & {
  DB: D1Database;
  PASS_TYPE_IDENTIFIER?: string;
  PASS_TEAM_IDENTIFIER?: string;
  PASS_SIGNING_CERT_P12_BASE64?: string;
  PASS_SIGNING_CERT_PASSWORD?: string;
  PASS_WEB_SERVICE_URL?: string;
};

function getBindings(c: Context): PassBindings {
  return c.env as PassBindings;
}

const pass = new Hono<AuthVariables>()
  .use("*", requireAuth)
  // pass.json の中身をプレビューする。証明書が無くても叩けるので開発時に便利。
  .get("/meishi.json", async (c) => {
    const bindings = getBindings(c);
    const userId = c.var.clerkUserId;
    const db = createDb(bindings.DB);
    const profile = await authorizedDb(db, userId).getMyProfile();
    if (!profile) {
      return c.json({ error: "Profile not found" }, 404);
    }

    const passTypeIdentifier =
      bindings.PASS_TYPE_IDENTIFIER ?? "pass.dev.animeishi.meishi";
    const teamIdentifier = bindings.PASS_TEAM_IDENTIFIER ?? "TEAMID0000";

    const profileUrl = new URL(c.req.url);
    profileUrl.pathname = `/user/${profile.id}`;
    profileUrl.search = "";

    const passJson = buildMeishiPassJson({
      passTypeIdentifier,
      teamIdentifier,
      serialNumber: `${profile.id}`,
      username: profile.username ?? "ユーザー",
      bio: profile.bio,
      favoriteQuote: profile.favoriteQuote,
      profileUrl: profileUrl.toString(),
    });

    return c.json(passJson);
  })
  // .pkpass バイナリを返す本命エンドポイント。
  // 署名証明書が設定されていれば署名済み zip を返す（TODO）。
  // 未設定なら 501 で「証明書未設定」を明示する。
  .get("/meishi.pkpass", async (c) => {
    const bindings = getBindings(c);
    const hasSigningCert = !!bindings.PASS_SIGNING_CERT_P12_BASE64;

    if (!hasSigningCert) {
      return c.json(
        {
          error: "pass_signing_not_configured",
          message:
            "Apple Wallet 用の署名証明書(PASS_SIGNING_CERT_P12_BASE64)が未設定です。開発者に証明書の投入を依頼してください。",
        },
        501,
      );
    }

    // TODO(#pkpass-sign): 証明書を用いて manifest.json + signature を生成し zip を返す。
    // WebCrypto では PKCS#7 detached signature を直接作れないため、
    // 軽量な ASN.1/PKCS#7 実装を移植するか、外部の署名サービスに委譲する必要がある。
    return c.json(
      {
        error: "pass_signing_not_implemented",
        message: "pkpass 署名処理は未実装です。",
      },
      501,
    );
  });

export { pass };
