// スキーマの introspection 型と gql.tada 設定（スカラーマッピング等）を、
// このファイルが読まれたプログラムに必ず取り込むための型 import。
// apps/mobile の typecheck は paths 経由で api のクライアントをコンパイルするが
// これらの .d.ts は誰にも import されずプログラム外になるため、
// ここで参照しないと setupSchema が未設定になり AnnictResult が never になる。
import type {} from "../graphql-env";
import type {} from "../graphql-config";
import { graphql } from "gql.tada";
import type { ResultOf } from "gql.tada";

// Annict GraphQL のクエリ文字列リテラルから、スキーマ由来の Result 型を
// 導くヘルパー（issue #734）。クエリは実行時に文字列のまま Annict へ送る
// ため、graphql() が返す DocumentNode は使わず型だけを使う。
//
// graphql() のオーバーロードは先頭が persisted cache 用シグネチャで、
// instantiation expression（typeof graphql<Q>）ではそちらの制約に衝突する。
// 単一シグネチャの関数に包むことで、通常の呼び出しとしてオーバーロード解決
// させて DocumentNode 型を取り出す。
//
// このファイルは import type でのみ参照すること。値 import すると
// Worker バンドルに gql.tada の GraphQL パーサが入る。
const tadaDocument = <Query extends string>(query: Query) => graphql(query);

/** クエリ文字列に対応する型付き DocumentNode 型。 */
type AnnictDocument<Query extends string> = ReturnType<
  typeof tadaDocument<Query>
>;

/**
 * クエリ文字列のレスポンス（data）型。
 *
 * @internal Hono RPC の schema を宣言出力するとき、TypeScript は依存した
 * 全ファイルの d.ts も出力しようとして gql.tada の内部型を直列化できずに失敗する
 * （TS4023 / TS7056）。rpcSchema.d.ts は Annict の型を参照しないため、
 * tsconfig.rpc.json の stripInternal でこの型を宣言出力から外す。
 */
export type AnnictResult<Query extends string> = ResultOf<
  AnnictDocument<Query>
>;
