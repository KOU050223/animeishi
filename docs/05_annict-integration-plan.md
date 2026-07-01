# 05. Annict 連携への設計し直し計画

## 背景と戦略

視聴記録機能を自前実装で持つと、Annict と機能が大きく競合する。そこで
**「記録は Annict に寄せ、Animeishi は Annict ユーザー向けの名刺・共有・分析レイヤーに徹する」**
方針へ転換する。

- **Animeishi の責務**: 名刺(MeishiCard)、QR 交換、プロフィール、AI 分析、OGP、フレンド
- **Annict の責務**: 視聴ステータス・視聴記録・作品マスタの主データ

Annict ユーザーは既に記録資産を持っているため、Animeishi に来た瞬間に空ではなく
「あなたのアニメ名刺」が作れる。オンボーディングの強さが段違いになる。

## 確定した設計方針

本計画の各決定は `/grill-me` セッションで一問ずつ詰めて確定したもの。

| # | 論点 | 決定 | 根拠 |
|---|---|---|---|
| 0 | 認証基盤 | **Clerk 維持**。Annict は OAuth「連携」に留める | Annict OAuth はログイン(OIDC)用途ではなく API 認可。自前セッション管理・既存認証資産/テストの破棄コストが、得られる「概念の純粋さ」に見合わない |
| 1 | Annict トークン保存 | **ネイティブはサーバー非保存**(SecureStore のみ)。**Web は例外**でサーバー(D1)に AES-GCM 暗号化保存 | ネイティブは SecureStore 長期保持が安全で D1 保存の価値が薄い。ただし Web は SecureStore が無く localStorage は XSS リスクで永続化できないため、Web に限りサーバー暗号化保存へ切り替える（下記「追補」で確定。当初の YAGNI 判断を Web 対応で改訂） |
| 2 | 通信経路 | **全て Workers API プロキシ経由**。ネイティブは Annict トークンを `X-Annict-Token` ヘッダで運ぶ。**Web はヘッダを使わず**サーバーが D1 から復号して使う | 「Annict へ書く」と「D1 キャッシュへ書く」を 1 リクエスト・1 箇所で原子的に完結。既存 `hono/client` 型推論・`apiClient` パターンを踏襲しモバイルに GraphQL を持ち込まない。Web は clerkUserId で D1 のトークンを引くためヘッダ不要 |
| 3 | 作品キャッシュ | **`annict_works`**(`annictWorkId` 主キーの軽量キャッシュ)。`watch_history`/`favorites` が参照 | annictWorkId(Int)を自然キーにでき、D1 autoincrement 仮想 ID の間接層が消える。作品メタが 1 箇所に集約。「触れた作品だけ」貯まるキャッシュが OGP/他人表示の要求と一致(全件同期不要) |
| 4 | 本人の読み取り | **Annict `viewer.libraryEntries` 直引き** + read-through で D1 更新。他人/OGP は D1 固定 | 本人読み取りを D1 にすると Annict 本家/Web で付けた記録が出ず連携体験が破綻。read-through で本人が一覧を開くたび D1 が最新化され、他人表示/OGP の鮮度も追加同期なしで上がる |
| 5 | read-through 書き込み | **全置換**(本人分を delete→insert、`db.batch()` でアトミック) | 「Annict が正」を貫くなら Annict 側の削除も反映が必要。差分 upsert だとゴミが残り続ける。libraryEntries は全状態を一度に取れるので全置換が自然 |
| 6 | OAuth フロー | モバイルが deep link で `code` 受領 → Workers `/me/annict/exchange` で `client_secret` 付き token 交換 → SecureStore 保存 | Annict は **PKCE 非対応**で `client_secret` 必須 → モバイルに埋め込めず交換は必ず Workers。redirect_uri をアプリ deep link にすると `expo-web-browser` がそのまま結果を返し、トークンを URL に載せずに済む(`code` は使い捨て短命) |
| 7 | 連携の強制 | **ソフトゲート**。名刺/QR/フレンドは未連携でも使える。記録/検索に触れた時に連携を促す | 名刺/QR/フレンドは Clerk のみで完結し Annict を要求する技術的理由がない。ハードゲートはオンボーディングの入口を自ら削る。記録系画面だけトークン前提にすれば分岐は局所化できる |
| - | score / comment | **後回し**(MVP はステータス連携のみ) | Annict の記録はエピソード単位 + 4 段階評価のため 1:1 置換不可。MVP では `score`/`comment`/`watchedAt` を落とす |

## Annict GraphQL API リファレンス(確認済み)

- エンドポイント: `https://api.annict.com/graphql`
- 認証: `Authorization: Bearer <access_token>`(OAuth2 認可コードフロー、**PKCE 非対応**)
- スコープ: `read`(既定) / `read write`(ステータス更新には `write` が必要)
- 認可エンドポイント: `https://api.annict.com/oauth/authorize`
- トークンエンドポイント: `POST https://api.annict.com/oauth/token`

### StatusState

確認済みの `StatusState` enum 値: `NO_STATE` / `WATCHING` / `WATCHED` / `ON_HOLD` / `STOP_WATCHING` / `WANNA_WATCH`

MVP の D1 キャッシュ `state` カラムはこの 5 値(`NO_STATE` を除く)をそのまま採用する。
旧 D1 status との対応(参考。新スキーマでは旧値は廃止し Annict 値を直接持つ):

| 旧 D1 status | Annict StatusState |
|---|---|
| `watching` | `WATCHING` |
| `completed` | `WATCHED` |
| `on_hold` | `ON_HOLD` |
| `dropped` | `STOP_WATCHING` |
| `plan_to_watch` | `WANNA_WATCH` |

### 主要クエリ / ミューテーション

```graphql
# 視聴ステータス更新（作品単位、write スコープ必須）
mutation UpdateStatus($workId: ID!, $state: StatusState!) {
  updateStatus(input: { workId: $workId, state: $state }) {
    clientMutationId
  }
}

# 自分のライブラリ（視聴ステータス付き作品一覧）取得
query MyLibrary($states: [StatusState!], $after: String) {
  viewer {
    libraryEntries(states: $states, first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        status { state }
        work { annictId title titleKana seasonName seasonYear image { recommendedImageUrl } }
      }
    }
  }
}

# 作品検索（マスタの代替）
query SearchWorks($titles: [String!], $seasons: [String!], $after: String) {
  searchWorks(titles: $titles, seasons: $seasons, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { annictId title titleKana seasonName seasonYear image { recommendedImageUrl } }
  }
}
```

> 注: `createRecord` は `episodeId` 必須・評価は `RatingState`(GREAT/GOOD/AVERAGE/BAD)で、
> 既存の 10 段階 `score` / 自由 `comment` とは 1:1 で対応しない。MVP では扱わない。

## データフロー

### 連携(OAuth)
```
モバイル                          Annict                   Workers API
  | openAuthSessionAsync(authorize URL, redirect=animeishi://annict)
  | ----------------------------> |
  |        ユーザー承認(read write)|
  | <--- redirect animeishi://annict?code=XXX (deep link)
  | POST /me/annict/exchange { code }  ----------------------> |
  |                                | <-- POST /oauth/token ----| (client_secret 付き)
  |                                | --- access_token -------> |
  | <----------- { accessToken, scope, annictUserId } --------|
  | SecureStore.setItem("annict_token", accessToken)
```
`client_secret` は Workers Secret(`ANNICT_CLIENT_SECRET`)。`code` は使い捨て短命なのでモバイル経由でも安全。

### 視聴ステータス読み取り(本人)
```
モバイル → GET /me/watch-histories (Authorization: Clerk JWT, X-Annict-Token: <token>)
  Workers:
    1. Annict viewer.libraryEntries を全状態・全ページ取得
    2. annict_works に upsert（触れた作品メタをキャッシュ）
    3. watch_history(本人分) を全置換: db.batch([delete本人分, insert取得分])
    4. 取得結果を返す
```

### 視聴ステータス更新(本人)
```
モバイル → PUT /me/watch-histories/:annictWorkId { state } (X-Annict-Token)
  Workers:
    1. Annict updateStatus(workId, state) を実行
    2. 成功後 annict_works upsert + watch_history(本人×作品) upsert
    3. 結果を返す
```

### 他人の名刺表示 / OGP
```
他人/クローラ → GET /users/:uid (本人トークンは無い)
  → D1 watch_history キャッシュ（本人が最後に開いた時のスナップショット）から表示
```
他人のトークンは取得できないため D1 キャッシュ固定。これは設計上の制約として UX に明記する。

## スキーマ変更(D1 / Drizzle)

クリーンスレート方針。Annict がマスタになるため、しょぼいカレンダー固有のカラム/テーブルは廃止する。

```text
+ annict_works          新規（キャッシュマスタ・自然キー）
    annictWorkId  integer PRIMARY KEY   -- Annict の annictId をそのまま主キーに
    title         text NOT NULL
    titleKana     text
    titleEn       text
    seasonName    text                  -- 例: "2026-spring"
    seasonYear    integer
    imageUrl      text
    updatedAt     integer(timestamp)

~ watch_history         意味を「Annict のキャッシュ」に再定義
    id          integer PK autoincrement
    userId      text → users.id (cascade)
    annictWorkId integer → annict_works.annictWorkId (cascade)   -- ← anime_titles 参照を張り替え
    state       text enum(WATCHING/WATCHED/ON_HOLD/STOP_WATCHING/WANNA_WATCH)
    updatedAt   integer(timestamp)
    unique(userId, annictWorkId) / index(userId)
    -- 廃止: score / comment / watchedAt / status(旧enum)

~ favorites             annictWorkId 参照へ張り替え
    annimeId(旧 anime_titles 参照) → annictWorkId integer → annict_works.annictWorkId

- anime_titles          削除（annict_works へ置換）
- sourceId / year / season / genres / thumbnailUrl 等しょぼい固有カラムは annict_works に持ち込まない
```

> 既存 D1 の `watch_history.score`/`comment` データは MVP では破棄(再連携で Annict から再構築)。
> 本番にデータが入っている場合は移行ではなく「初回 read-through で上書き」される。

## 影響範囲(既存コードの改修・削除)

### API (`services/api`)
- **追加**: `src/lib/annict/`（GraphQL クライアント、OAuth token 交換ヘルパ、StatusState マッピング、`X-Annict-Token` 読み取りミドルウェア）
- **追加**: `src/routes/annict.ts`（`POST /me/annict/exchange`、`GET /me/annict`(連携状態は「X-Annict-Token の有無」で判定するためサーバー状態は持たない → 実質トークン検証 `oauth/token/info` のラッパ)、`DELETE` 相当はクライアントが SecureStore を消すだけ）
- **改修**: `src/routes/watch-history.ts`（Annict libraryEntries / updateStatus 経由 + read-through 全置換）
- **改修**: `src/routes/titles.ts`（searchWorks プロキシへ）
- **改修**: `src/db/schema.ts` + 新規マイグレーション（annict_works 追加、watch_history/favorites の FK 張り替え、anime_titles 削除）
- **改修**: `src/repository/authorizedDb.ts`（annict_works upsert / watch_history 全置換メソッド追加、anime_titles 系メソッド削除）
- **改修**: `src/schema/validators.ts`（`watchHistoryUpsertSchema` を `{ state }` のみに。score/comment/watchedAt 削除）
- **削除**: `src/cron/*`、`wrangler.toml` の `[triggers]`/`crons`、`src/repository/animeSyncRepo.ts`、`__tests__/cron.test.ts`、`__tests__/titles.test.ts`(searchWorks 用に書き直し)

### モバイル (`apps/mobile`)
- **追加**: `lib/annict/`（SecureStore トークン管理、OAuth 連携フロー `useAnnictConnect`、`X-Annict-Token` を付与する apiClient ラッパ）
- **追加**: Annict 連携を促す画面/モーダル（ソフトゲート用）
- **改修**: `lib/useWatchHistory.ts`（annictWorkId ベース、`state` のみ、X-Annict-Token 付与）
- **改修**: `app/(tabs)/watch-history.tsx` / `anime-list.tsx`（ソフトゲート：未連携時は連携誘導を表示）
- **改修**: `lib/useAnimeList.ts`（searchWorks プロキシ経由へ）
- **改修**: 関連テスト（`useWatchHistory.test.ts`、`useAnimeList.test.ts`）

## 段階的リリース計画(PR 分割)

各 PR は単体で main にマージ可能・テストが緑になる粒度。feature ブランチ → PR の運用。

1. **PR1: スキーマ刷新 + しょぼいカレンダー撤去**
   - `annict_works` 追加、`watch_history`/`favorites` の FK 張り替え、`anime_titles` 削除のマイグレーション。
   - `src/cron/*` / `animeSyncRepo` / 関連 cron テスト削除、`wrangler.toml` の cron triggers 削除。
   - `authorizedDb` の anime_titles 系を annict_works 系へ。`validators` の watch スキーマを `{ state }` に。
   - この PR 単体では Annict 通信はまだ無く、watch_history は「ローカルキャッシュ」として annictWorkId で動く状態にする。
2. **PR2: Annict GraphQL クライアント + OAuth 交換基盤**
   - `src/lib/annict/`（GraphQL クライアント、`X-Annict-Token` ミドルウェア、StatusState マッピング）。
   - `POST /me/annict/exchange`（`code` → token、`ANNICT_CLIENT_SECRET` Secret）。
   - モバイル: SecureStore トークン管理 + `useAnnictConnect`（`expo-web-browser`）。連携画面。読み取り/書き込みはまだ繋がない。
3. **PR3: 視聴ステータス読み取りを Annict 経由 + read-through 全置換**
   - `GET /me/watch-histories` を libraryEntries 取得 → annict_works upsert → watch_history 全置換に差し替え。
   - モバイル `useWatchHistory` に `X-Annict-Token` 付与。
4. **PR4: ステータス更新を Annict updateStatus に**
   - `PUT /me/watch-histories/:annictWorkId` を updateStatus + キャッシュ更新に。`write` スコープ前提。
5. **PR5: 作品検索を searchWorks プロキシへ**
   - `GET /titles`(または新 `/works/search`) を searchWorks プロキシに。`useAnimeList` を差し替え。
6. **PR6: モバイルのソフトゲート + UI 仕上げ**
   - 記録/検索タブ到達時の連携誘導、未連携時の空状態、連携済み判定の取り回し。
7. **(将来) PR7: エピソード記録・RatingState 対応**（score/comment の Annict 化、`createRecord`）。

## 未決事項 / リスク

- **Annict GraphQL レート制限**: 値を要確認。本人 read-through を毎回フル取得すると重いユーザーで負荷大 → React Query キャッシュ + 「初回フル/以降は差分」の最適化を将来必要に応じて。
- **libraryEntries の全ページ取得コスト**: 数百〜千作品のヘビーユーザーで全置換の delete→insert が大きくなる。PR3 時点で件数上限/ページング戦略を計測。
- **OGP に視聴データを出すか**: 現状 `user.ts` の OGP はプロフィールのみ(視聴データ未使用)。視聴サマリを OGP に載せるなら D1 キャッシュから集計するエンドポイントが別途必要(本計画スコープ外、将来検討)。
- **`GET /me/annict`(連携状態)の実体**: **ネイティブ**はサーバーがトークンを保存しないため「連携済み」はクライアントの SecureStore 有無で判定し、`X-Annict-Token` があればそれで `oauth/token/info` を検証する。**Web**（追補で確定）はサーバーが D1 に保存したトークンを復号して `oauth/token/info` で検証し、`connected` を返す（クライアントは localStorage を見ない）。
- **未連携ユーザーの離脱計測**: ソフトゲートでも記録機能の連携誘導 → 連携完了のコンバージョンを計測する。
- **`redirect_uri` 登録**: Annict アプリ設定に `animeishi://annict`(本番)とローカル/プレビュー用を登録する必要がある。
```

---

## 追補: Web(ブラウザ)での Annict 連携 — サーバー暗号化保存方式

### 背景

初期設計は「サーバー非保存 + `X-Annict-Token` ヘッダ」（表1・項1/2）で、
モバイル(SecureStore)を前提にしていた。しかし Web ビルドでは:

- SecureStore が無く、localStorage は XSS で長期トークンを抜かれるため本番では永続化を禁じていた
  （`storage.web.ts` の `isProductionWeb` ガード）。結果、**Web では連携しても保持できない**。
- OAuth の `redirect_uri` が Web では実 URL(`https://<host>/annict`)になるが、その
  Expo Router ルートが無く **「Unmatched Route」(404)** で連携が完了しなかった。

### 方針

**Web のみ**、Annict アクセストークンを **Workers 側で AES-GCM 暗号化して D1 に保存し、
Clerk 認証(`clerkUserId`)をキーに参照する**。ネイティブは従来のヘッダ方式を維持し、両系統を併存させる。

> Cookie は使わない。Web でも Clerk JWT(Authorization ヘッダ)は既に全リクエストに乗るため、
> `clerkUserId` で `annict_tokens` を引けば連携済み判定もトークン参照もできる。Cookie を足すと
> CORS `credentials`・`SameSite`・CSRF の複雑さが増えるだけで、認可の本質は Clerk JWT が担う。
> トークンは JS から読めないサーバー D1 にのみ暗号化保存されるため、XSS でも漏れない（目的達成）。

| 項目 | ネイティブ (iOS/Android) | Web (ブラウザ) |
| --- | --- | --- |
| トークン保存先 | 端末 SecureStore | Workers → D1 に AES-GCM 暗号化保存 |
| 通信での運び方 | `X-Annict-Token` ヘッダ | サーバーが D1 から復号して利用（クライアントは持たない） |
| 認可のキー | Clerk JWT | Clerk JWT (`clerkUserId`) |
| 連携判定 | SecureStore のトークン有無 | サーバー `GET /me/annict`(D1 の行有無 + token/info) |
| コールバック | deep link `animeishi://annict` | 実ページ `/annict`(Expo Router ルート) |

### サーバー側

- **`annict_tokens` テーブル**: `userId`(PK, Clerk) / `encryptedToken` / `annictUserId` / `scope` /
  `createdAt` / `updatedAt`。トークンは AES-GCM で暗号化して保存（平文で置かない）。
- **暗号鍵**: `ANNICT_ENCRYPTION_KEY`(Workers Secret, 32byte base64)。`lib/annict/crypto.ts` が
  Web Crypto API(`crypto.subtle`)で暗号化/復号する。
- **`POST /me/annict/exchange`**: `mode: "web"` のとき交換後トークンを暗号化して D1 保存し、
  **トークンをレスポンスボディに含めない**（連携済みフラグと annictUserId のみ返す）。
  `mode: "native"`(既定)は従来通りトークンをボディで返す。
- **`requireAnnictToken`**: トークン解決の順序を **`X-Annict-Token` ヘッダ → D1(clerkUserId で復号)** とする。
  D1 経由では `clerkUserId` が要るため `AuthVariables`(requireAuth の後段)を前提にする。
- **`POST /me/annict/disconnect`**: D1 行削除（Web の連携解除）。
- **`GET /me/annict`**: ヘッダがあればそれで `token/info` 検証、無ければ D1 のトークンで検証する。
- **CORS**: Cookie を使わないため変更不要（既存のヘッダ許可に `X-Annict-Token` は既にある）。

### フロント側 (apps/mobile / Web)

- **`app/annict.tsx`**: Web の OAuth 着地ルート。URL の `code`/`state` を読み、`state` を照合(sessionStorage)、
  `exchange`(mode:web, Clerk JWT 付き)を叩き、成功後に連携元画面へ `router.replace`。
- **`useAnnictConnect`**: Web は `openAuthSessionAsync` を使わず通常のページ遷移で authorize へ飛ばし、
  戻りは `annict.tsx` が処理する。ネイティブは従来フロー。
- **`useAnnictConnection`**: Web はサーバー `GET /me/annict` の結果で判定（localStorage を見ない）。

### 残リスク / 注意

- 書き込み系(exchange/disconnect)は Clerk JWT で認可する。トークンは常に D1 側にあり
  クライアントへ渡さないため、**Annict トークンの直接流出**（トークン文字列の窃取）は防げる。
  ただし同一オリジンの XSS から Clerk 認証済み API（記録更新など）を操作される余地までは
  消せない点は残リスクとして留意する（これは Cookie 方式でも同様）。
- 本番 D1 マイグレーション適用が必要（`annict_tokens` 追加、`migrations/0004_annict_tokens.sql`）。
- `ANNICT_ENCRYPTION_KEY` の本番 Secret 設定が必要（`wrangler secret put`）。
