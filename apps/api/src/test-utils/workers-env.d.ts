// テスト（Workers プール）で `import { env } from "cloudflare:workers"` が返す
// バインディングの型。wrangler types の生成物は持たないため、テストが参照する
// バインディングだけを Cloudflare.Env に宣言マージする（wrangler.toml の
// [[d1_databases]] / [[r2_buckets]] に対応）。
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    AVATARS: R2Bucket;
  }
}

// vitest が optional-runtime-types 経由で lib.dom.d.ts を引き込むと、
// CacheStorage は @cloudflare/workers-types ではなく DOM 側に解決されて
// default を持たなくなる。Workers の既定キャッシュ（caches.default）を
// テストでも使えるよう宣言マージで補う。
interface CacheStorage {
  readonly default: Cache;
}
