# Annict GraphQL の型付け（gql.tada）

Annict GraphQL のクエリ・スキーマを変えるとき、または型エラーの原因を調べるときに読む。
クライアントの使い方自体は `apps/api/src/lib/annict/client/` のコードを参照。

## 構成

- `apps/api/src/lib/annict/schema.graphql`
  Annict 公式リポジトリ（[annict/annict](https://github.com/annict/annict)）の
  `rails/app/graphql/beta/schema.graphql` を置いた SDL。Annict の introspection
  エンドポイントは管理者権限が必要で個人トークンでは引けないため、
  公開 SDL を正として使う（issue #734）。
- `apps/api/src/lib/annict/graphql-env.d.ts`
  `schema.graphql` から gql.tada が生成する introspection 型。手で編集しない。
- `apps/api/src/lib/annict/graphql-config.d.ts`
  gql.tada の設定（fragment マスク無効化、`DateTime` → `string` のスカラーマッピング）。
- `apps/api/src/lib/annict/client/tada.ts`
  クエリ文字列リテラルから `AnnictResult` / `AnnictVariables` 型を導くヘルパー。
  実行時に送るクエリは従来どおり文字列で、`annictGraphQL<T>` の `T` に
  `AnnictResult<typeof クエリ定数>` を渡して使う。

## スキーマの更新手順

1. 最新の SDL を取得して `schema.graphql` を上書きし、oxfmt で整形する
   （上流の SDL は説明文が複数行の `"""` ブロックで、整形すると 1 行に畳まれる）。

   ```bash
   curl -fsSL https://raw.githubusercontent.com/annict/annict/main/rails/app/graphql/beta/schema.graphql \
     -o apps/api/src/lib/annict/schema.graphql
   vp -C apps/api run fmt
   ```

2. introspection 型を再生成する（出力先は `apps/api/tsconfig.json` の
   `tadaOutputLocation` を見る）。

   ```bash
   vp -C apps/api exec gql.tada generate-schema ./src/lib/annict/schema.graphql
   ```

3. `vp run typecheck` を通す。スキーマに無いフィールド・型の食い違いは
   ここで型エラーになる。

## クエリを追加・変更するときの約束

- クエリは `${...}` を含まない静的テンプレートリテラルで書く。
  テンプレート展開（`image { ${WORK_IMAGE_FIELDS} }` など）があると
  gql.tada が型を推論できない。数値引数も定数参照せず直接書く。
- 各クエリの `image { ... }` 選択は `client/workNodes.ts` の
  `WORK_IMAGE_FRAGMENT` と同一に保つ。レイアウト（`image { ` 直後の改行・
  フィールドの列0始まり）は旧 `WORK_IMAGE_FIELDS` 展開と同一の送信文字列を
  保つためのもので、変えないこと。
- `includeViewerStatus` のような動的クエリが必要な場合は、静的リテラルを
  土台に `.replace()` 等で変種を作る（`workDetailQuery` を参照）。
