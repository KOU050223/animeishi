// スキーマの introspection 型と gql.tada 設定（スカラーマッピング等）を、
// このファイルが読まれたプログラムに必ず取り込むための型 import。
// apps/mobile の typecheck は paths 経由で api のクライアントをコンパイルするが
// これらの .d.ts は誰にも import されずプログラム外になるため、
// ここで参照しないと setupSchema が未設定になり AnnictResult が never になる。
import type {} from "../graphql-env";
import type {} from "../graphql-config";
import { graphql } from "gql.tada";
import type { ResultOf, VariablesOf } from "gql.tada";

// Annict GraphQL のクエリ文字列リテラルから、スキーマ由来の Result / Variables
// 型を導くヘルパー（issue #734）。クエリは実行時に文字列のまま Annict へ送る
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
export type AnnictDocument<Query extends string> = ReturnType<
  typeof tadaDocument<Query>
>;

/** クエリ文字列のレスポンス（data）型。 */
export type AnnictResult<Query extends string> = ResultOf<
  AnnictDocument<Query>
>;

/** クエリ文字列の変数型。 */
export type AnnictVariables<Query extends string> = VariablesOf<
  AnnictDocument<Query>
>;
