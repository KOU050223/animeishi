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

`shared` 側はモジュールグラフとストレージ（D1 / R2）をファイル間で共有するため、
`vi.mock` でモジュールを差し替えるファイルを置くとモック実体のずれで失敗する。
新しいテストファイルは既定で isolated に入る（`src/**/*.test.ts` の catch-all）。
`repository.test.ts`・`lib/**` など shared の include に合うファイルだけが shared に入る。
