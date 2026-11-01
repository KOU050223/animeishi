---
name: devin-issue-sweep
description: open な GitHub Issue をクラウドの Devin（Devin MCP）に並列で実装させ、Claude がマネージャー兼最終レビュアーとしてレビュー・マージまで進める。「Issue を Devin で消化して」「issue 消化ループ」「Devin に並列で投げて」などのときに使う。
argument-hint: "[Issue 番号の列挙（省略時は open な Issue 全部）]"
---

# Devin クラウドで Issue を並列消化する

open な GitHub Issue のうち自律的に完了できるものを、クラウドの Devin に並列で実装させ、
マージまで進める。引数で Issue 番号が渡されたらそれだけを対象にし、なければ open な Issue
すべてを対象にする（マイルストーンやラベルでは絞らない）。

## 役割

- あなたはマネージャー兼最終レビュアー。実装コードは自分で書かない
- やること: Issue の選定と振り分け、ブリーフ作成、監視、PR の最終レビュー、マージ判断
- 実装・セルフレビュー・修正・PR 作成・E2E は Devin のクラウドセッションに任せる
  （ローカルで worktree や Devin CLI は使わない）

## 前提の確認（最初に 1 回）

1. Devin MCP のツール（`devin_session_create` / `devin_session_gather` /
   `devin_session_interact`）が使えること。使えなければ止めて、`claude mcp add` での
   登録と Claude Code の再起動をユーザーに頼む
2. `gh auth status` が通ること

## 1. Issue の選定

1. `gh issue list --state open --limit 200 --json number,title,labels,body` で一覧を取る
2. 各 Issue について次を確認する
   - 実装がすでに別 PR でマージ済みでないか（`gh pr list --state merged --search "<番号>"`）。
     マージ済みなら着手せず「着手しなかった」に入れる
   - 対応する open な PR がすでにないか（`gh pr list --state open --search "<番号>"`）。
     あればそれを引き継ぐ（新しいセッションは作らず、その PR のレビューから始める）
3. 次に当たる Issue は着手しない（最後の報告に理由と一緒に載せる）
   - ユーザーの作業や判断がないと進まないもの（外部サービスの設定、秘密情報・API キーの発行、
     デザイン判断、仕様が決まっていないもの）
   - ユーザー側の作業量が大きいもの
   - 本番環境への破壊的な操作が必要なもの
   - トラッカー・まとめ用の Issue（子 Issue を束ねているだけのもの）
   - 迷ったら着手しない側に倒す
4. 着手する Issue を「触るファイル・機能領域」でグループに分ける。
   同じグループの Issue は順番に、別のグループは並列に進める。
   D1 マイグレーションを足す Issue は、番号の衝突を避けるため同じグループにまとめる

## 2. セッションの起動

グループごとに先頭の Issue のセッションを作る。1 回の `devin_session_create` で
複数セッションをまとめて作ってよい。

- `devin_mode: "swe-2-high"`
- `repos: ["KOU050223/animeishi"]`
- `tags: ["issue-<番号>", "issue-sweep"]`
- `platform`: `apps/mobile` の認証・ナビゲーション・ホーム周りなど、E2E フローが通る画面を
  触る Issue は `"macos"`。それ以外は指定しない（Linux）
- `title`: Issue のタイトルを動詞から始まる 8 語以内に要約したもの
- `structured_output_schema`:

```json
{
  "type": "object",
  "properties": {
    "status": { "enum": ["pr_ready", "blocked", "needs_user"] },
    "pr_url": { "type": "string" },
    "e2e": { "enum": ["pass", "fail", "not_required"] },
    "summary": { "type": "string" }
  },
  "required": ["status", "summary"]
}
```

返る `session_id` には `devin-` が付かない。gather / interact に渡すときは付ける。
Issue 番号と session_id・PR 番号の対応は会話の中で表にして持ち続ける。

### ブリーフ（prompt）に必ず書くこと

```text
GitHub Issue #<番号> を実装してください。Issue 本文: <URL>

- main から feature ブランチを切る。main へ直接 push しない
- push 前に vp run typecheck・vp run lint・vp run fmt:check・vp run test を通す
- 実装後にセルフレビューし、指摘を修正してから PR を作る
- PR 本文に `Closes #<番号>` を入れる
- スコープ外の変更を混ぜない。スコープ外の課題を見つけたら issue は作らず、
  structured output の summary に書く
- 仕様の解釈が分かれる点があれば、推測で進めずに status=needs_user で止まる
- CodeRabbit の pending は待たない（CI の結果だけ確認する）
- （macOS のとき）PR 作成後に vp run @animeishi/mobile#e2e:ios を実行し、
  結果（PASS / 失敗の原因）を PR にコメントする。詳細は docs/development/e2e-ios.md
- （マイグレーションを足すとき）apps/api/migrations の最新番号の次を使う
- 終わったら structured output を報告して待機する
```

Issue 固有の注意（関連する docs のパス、触ってはいけない箇所など）があれば足す。

## 3. 監視

- `devin_session_gather` に作業中の全セッションを渡し、`timeout_seconds: 590` で待つ。
  返ってきた時点で落ち着いたセッションを処理し、残りでまた gather する
  （外部 MCP クライアントには完了通知が来ないので、これがポーリングの代わり）
- 落ち着いたセッションは `devin_session_interact` の `get` で `status_detail`・
  `pull_requests`・`structured_output` を見る。structured output は古い可能性があるので、
  最後の発言は `get_messages` で確かめる
  - `waiting_for_user` で技術的な質問をしている → 答えられるものは `message` で答える。
    仕様判断が必要なものは「ユーザーに戻す」
  - `status: error` → 1 回だけ `message` で再開を促す。だめならユーザーに戻す
  - PR ができた → 「4. レビュー」へ
- 1 時間以上ステータスが変わらないセッションは `get_messages` で様子を見る

## 4. PR のレビューと修正依頼

1. `gh pr view <番号> --json state,mergeable,headRefOid,files,body` と
   `gh pr checks <番号>` と `gh pr diff <番号>` を見る。
   すでに MERGED / CLOSED なら（ユーザーが自分で処理した）それに従う
2. 未解決のレビュースレッドを GraphQL で確認する
   （`reviewThreads(first:100){nodes{isResolved}}`）
3. diff を自分で読み、次を確かめる
   - Issue の要件をすべて満たしている
   - スコープ外の変更（無関係なファイル、lockfile の無関係な更新、本番依存の追加）がない
   - 他プロセスを巻き込む処理（広い kill など）や秘密情報の混入がない
4. 問題があれば、同じセッションに `message` で具体的に（ファイル・行・期待する形）直させ、
   また監視に戻る。同じ問題（同じ失敗チェック・同じ指摘）で 2 回直させても直らなければ
   ユーザーに戻す
5. 先にマージされた PR とコンフリクトしたら、`message` で main を取り込ませて解消させる

## 5. マージ

次をすべて満たしたら、ユーザーの確認なしでマージしてよい。

- CI がすべてグリーン（Lint・typecheck・test を含む。pending もない）
- Issue の要件をすべて満たしていることを、diff を読んで確認した
- 未解決のレビュースレッドがない
- スコープ外の変更が混ざっていない
- E2E が必要な PR は、PR に PASS のコメントがある
- マイグレーション（`apps/api/migrations/`）を含まない。含む PR はマージせず
  ユーザーの確認待ちにする（main へのマージで本番 D1 に自動適用されるため）

マージは `gh pr merge <番号> --merge` で行い、リモートブランチは
`gh api -X DELETE repos/KOU050223/animeishi/git/refs/heads/<branch>` で消す。
マージしたら、同じグループの次の Issue のセッションを起動し、
終わったセッションは `devin_session_interact` の `sleep` で止める（terminate しない）。

## ユーザーに戻すケース

- 要件の解釈が分かれる、または仕様判断が必要
- Devin が同じ問題を 2 回直させても直せない
- 上のマージ条件を満たせない（マイグレーションを含む PR を含む）
- 作業中に見つけたスコープ外の課題（起票を提案する。自分では起票しない）

戻すときは、PR があれば PR に、なければ Issue に `gh` でコメントを残し、
そのセッションは sleep する。コメントには次の 3 点を書く。

- 現在の状態（どこまで進んだか）
- 止まっている理由
- ユーザーがやるべき具体的なアクション（判断してほしい選択肢があれば列挙する）

## 完了条件と報告

対象の Issue がすべて「マージ済み」「ユーザーの対応待ち」「着手しなかった」のどれかに
分類されたら終了する。最後に次の 4 つを報告する。

- マージ済み（PR へのリンク付き）
- ユーザーの対応待ち（コメントを残した PR / Issue へのリンクと、必要なアクションの要約）
- 着手しなかった Issue（理由付き）
- 消費した ACU（セッションごとの `acus_consumed` と合計）と、スコープ外として提案する Issue
