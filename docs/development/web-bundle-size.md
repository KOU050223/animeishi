# Web バンドルサイズ予算（issue #721）

Web 版の初回 JS が依存の追加やネイティブ専用モジュールの混入で膨らんでも
気づけるよう、`bundle-check.yml` の web matrix でサイズ上限を検査する。

## 計測の仕組み

`apps/mobile/scripts/check-web-bundle-size.mjs` が `expo export -p web` の
出力（`apps/mobile/dist/`）を走査する。

- **「初回に読み込む JS」** = export 物の各 `*.html` が `<script src>` で
  読み込むファイルの合計 gzip サイズ。ファイル名のハッシュやチャンク名に
  依存しないため、Expo 側のチャンク分割が変わっても追従できる
- Sentry など動的 import で遅延読み込みされるチャンクは HTML の
  `<script src>` に現れないため、上限の対象外になる
- ページごとに合計を計算し、1 ページでも上限を超えたらジョブが失敗する
- PR ではベースブランチ側も同じ条件で export・計測し、ページ単位の差分を
  ジョブサマリー（各ジョブの Summary タブ）に出す。ベース側の計測が失敗
  してもチェック自体は止まらない（差分なしで上限チェックだけが走る）

## ローカルで計測する

```bash
pnpm --filter @animeishi/mobile exec expo export --platform web
pnpm --filter @animeishi/mobile bundle:size
```

`pnpm build:web` 済みなら `bundle:size` だけでよい（dist/ をそのまま読む）。

主なオプション:

```
--dist <dir>           計測対象の export 出力（既定: apps/mobile/dist）
--max-bytes <n>        ページあたりの gzip 上限を一時的に変える
--write-report <file>  計測結果を JSON で保存（差分の元データ用）
--baseline <file>      保存済みレポートとの差分を表示
--label <text>         レポートに表示する名前（"base abc123" など）
--no-check             上限チェックをしない（baseline 計測用）
```

ベースとの差分をローカルで見る例（リポジトリルートから実行）:

```bash
git worktree add --detach ../base main
(cd ../base && vp install && pnpm --filter @animeishi/mobile exec expo export -p web)
node apps/mobile/scripts/check-web-bundle-size.mjs \
  --dist ../base/apps/mobile/dist --write-report /tmp/base.json --no-check
node apps/mobile/scripts/check-web-bundle-size.mjs --baseline /tmp/base.json
```

## 上限の決まり方

上限は `check-web-bundle-size.mjs` 先頭の `BUDGET_GZIP_BYTES`（現行: 1.2 MiB =
1,258,291 B）。#719 マージ直後の計測値は index.html で 1,054,009 B、
全ページ最大で 1,071,533 B（gzip）で、最大ページ比で約 +17% の余裕を
持たせてある。

上限を変えるときは、その時点の計測値と選んだ余裕の根拠を PR に書く。

## 上限を超えたとき

ジョブサマリーまたは stderr に、超過したページと index.html のチャンク内訳が
出る。まずどのチャンクが増えたかを確認する。

- 新しい依存を足した → 本当に web で必要か、動的 import で遅延化できないか
- ネイティブ専用コードが混ざった → `.web.ts` / `.native.ts` の拡張子分割で
  web 側から外す（AGENTS.md「プラットフォーム差異の吸収」）
- 正当な増加 → `BUDGET_GZIP_BYTES` を計測値つきで更新する
