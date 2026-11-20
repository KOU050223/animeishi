// テスト（Workers プール）で `import { env } from "cloudflare:workers"` が返す
// バインディングの型。wrangler types の生成物は持たないため、テストが参照する
// バインディングだけを Cloudflare.Env に宣言マージする（wrangler.toml の
// [[d1_databases]] / [[r2_buckets]] に対応）。
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    AVATARS: R2Bucket;
    // dアニメ話記録ジョブ（issue #477）。wrangler.toml の [[workflows]] に対応。
    // miniflare が実クラスをバインドするためテストからも利用できるが、
    // ルートテストではスタブに差し替える。
    DANIME_EPISODE_IMPORT: Workflow;
    // .dev.vars の暗号化キー。Workflow がトークンを復号するのに使う。
    ANNICT_ENCRYPTION_KEY?: string;
    // Workflow の待ち時間・ステップ上限の上書き（テスト用、任意）。
    DANIME_WRITE_INTERVAL_MS?: string;
    DANIME_RATE_LIMIT_WAIT_MS?: string;
    DANIME_TRANSIENT_RETRY_WAIT_MS?: string;
    DANIME_WORKFLOW_STEP_BUDGET?: string;
    DANIME_SUBREQUEST_BUDGET?: string;
  }
}

// vitest が optional-runtime-types 経由で lib.dom.d.ts を引き込むと、
// CacheStorage は @cloudflare/workers-types ではなく DOM 側に解決されて
// default を持たなくなる。Workers の既定キャッシュ（caches.default）を
// テストでも使えるよう宣言マージで補う。
interface CacheStorage {
  readonly default: Cache;
}
