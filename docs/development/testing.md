# テスト構成（mobile / api）

テストの設定を変えるとき、テストがどの環境で動くかを調べるときに読む。
新しいテストをどこに置くかのルールはルートの AGENTS.md を参照。

## mobile（jest / vitest）

mobile のテストは jest と vitest に分かれている（issue #249）。
`vp run @animeishi/mobile#test` は `test:vitest`（vitest）を先に回してから jest を回す。

- **vitest**（`apps/mobile/vite.config.ts` の `test` ブロック）: RN / Expo / jest-expo のモックに
  依存しない純ロジックのテスト。`*.unit.test.ts` が対象。
  jsdom は mobile の devDependency（issue #276）
- **jest**（`apps/mobile/jest.config.cjs`）: 上記以外（コンポーネントテスト、
  `jest.mock` でモジュールを差し替えるテスト、jest.setup.js の初期化に依存するテスト）。
  `*.unit.test.ts` は `testPathIgnorePatterns` で対象から外している

`@/` と `@animeishi/*` の解決は両設定で揃えている。

## api（Workers プール）

api の vitest（`apps/api/vite.config.ts` の `test` ブロック。issue #281）は
`@cloudflare/vitest-plugin` の Workers プールで、`isolated`（既定の
isolate: true。ファイルごとに workerd を起動）と `shared`（isolate: false。
workerd を共有して起動回数を削減。issue #299）に分かれている。
Workers バインディングに依存しないテストは `node` プロジェクト（Node.js
プール）で実行する。`node` は `extends: false` で宣言元の設定を継承せず、
cloudflareTest プラグインが pool を Workers プールに書き換えるのを回避している。

`maxWorkers` はルートの `test`（isolated / shared に継承される）と
`node` プロジェクトでローカルのみコア数の半分（切り捨て）に設定している
（issue #812）。
Workers プールは各ワーカーが workerd を起動するため、vitest 既定の
コア数 - 1 だと並列 worktree 運用でホストの CPU・メモリを圧迫し、
D1 呼び出しの遅延でテストが落ちることがあった。CI は占有ランナーで
競合が起きないため既定のまま（減らすと transform が遅くなる）。
`VP_RUN_CONCURRENCY_LIMIT` はプールのワーカー数に効かない点は
mobile の jest と同じ。

`shared` 側はモジュールグラフとストレージ（D1 / R2）をファイル間で共有するため、
`vi.mock` でモジュールを差し替えるファイルを置くとモック実体のずれで失敗する。
新しいテストファイルは既定で isolated に入る（`src/**/*.test.ts` の catch-all）。
`repository.test.ts`・`lib/**` など shared の include に合うファイルだけが shared に入る。

## 高負荷時のタイムアウト

mobile の jest と api の各 vitest プロジェクトは、並列 worktree による
CPU 競合を考慮してテスト単位の上限を 30 秒にしている。無限待ちの検出も
上限内で行う。danime-core の性能テストは `process.cpuUsage()` の user + system
を測り、他プロセスによる待機時間を上限に含めない。テスト自体の実時間上限は
60 秒。pre-push と CI は従来どおり全テストを実行する。

vitest の `hookTimeout` は `testTimeout` とは別に既定 10 秒しかない。
`beforeEach` で重い処理をすると 30 秒のテスト上限より先に hook が落ちる。
api の `setupTestDb`（test-utils/setup-db.ts）はその対策として、DDL と
データリセットの全ステートメントを `d1.batch()` の 1 往復にまとめている
（issue #812）。同じく mobile の `MenuPicker.web.test.tsx` と
`BottomSheet.web.test.tsx`（jest.jsdom-env.cjs 環境）では、react-native-web
への差し替えに必要な `jest.resetModules()` + `require` を beforeAll で
1 回だけ行い、テストごとのモジュール再評価を避けている。
