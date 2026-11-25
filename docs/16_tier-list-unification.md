# Tier 表の 1 モデル統合の設計

issue #724。シーズン・キャラクター・カスタムの 3 系統に分かれていた
tier 表を、DB・API・mobile クライアントの 1 モデルに統合する。
issue の「決定（2026-11-24）」コメントに従って実装した。

## 背景

3 系統は「シーズン版 → キャラ版（#169）→ カスタム版（#348）」の順に
それぞれ独立したテーブル・API・画面として積み増されたため、同じ
概念の実装が 3 組存在していた。いいね・通報・公開フィード・共有の
各面でもテーブルとパスが kind ごとに分かれ、修正を 3 か所に
書き写す必要があった。加えてカスタム版だけタイトルをユーザーが
付ける・items の対象が作品かキャラか違う、という小さな差を除けば
表現するものは同じだった。

## 決めたこと

### DB

- 表は `tier_lists`（id・user_id・kind・season・annict_work_id・title・
  description・tiers_json・share_token・is_public・created_at・
  updated_at）の 1 本に統合し、`tier_list_items` は `annict_work_id` /
  `annict_character_id` のどちらかを持つ形にした
- スコープの一意制約は「season なら (user_id, season)」「character なら
  (user_id, annict_work_id)」の部分ユニークインデックス 2 本で表す。
  custom は複数持てるので制約しない
- kind とスコープ・items の対象の不一致は CHECK で拒否する
  （season は annict_work_id 不可、character は annict_work_id 必須、
  custom は両方 null、character の items は annict_character_id 必須）
- いいねは `tier_list_likes`（user_id + tier_list_id）、通報は reports の
  `target_tier_list_id` 1 列に統合。旧の kind 列・3 テーブルは移行後に
  DROP する
- 公開フィードは kind をまたいだ union ではなく 1 テーブルから取る。
  カードの種別表示・workTitle など表示用の情報は応答に残す

採らなかった案:

- **kind ごとの参照列を持たず JSON に埋める** — FK と部分ユニーク
  インデックスが効かず、参照整合性をアプリ層だけで守ることになる
- **3 テーブルのまま公開面だけ統合する** — 自分の表の保存・取得・
  削除・共有が 3 系統残り、効率化の主目的を満たさない
- **既存の character_tier_lists を親テーブルに寄せる** — 主キー列の
  意味（id の空間）が系統ごとにずれる。全系統を新しい連番空間へ
  コピーする方が参照先の一意性を保てる

### 移行

- `PRAGMA defer_foreign_keys=ON` で FK 検査を遅延させ、新テーブルへ
  `INSERT ... SELECT`（character/custom の id は旧テーブルの最大 id
  をオフセットに加算して連番に詰め直し）、子テーブル（items・
  いいね・通報）は新しい親 id へ写してから旧テーブルを DROP する
- drizzle-kit generate の出力は `__new_*` → RENAME の再作成で、
  旧テーブルの FK が新テーブルを指せずデータを消す構成だった。
  RENAME 時に子テーブルの REFERENCES が追従書き換えされる
  SQLite の性質を使い、子テーブル側の FK を先に新テーブルへ向けて
  から親を差し替える形に手で組み替えた（0047）

### API

- 自分の表は `/me/tier-lists` に一本化する。
  - `GET /me/tier-lists?kind=` — 一覧（kind フィルタ可。items は含まない）
  - `POST /me/tier-lists` — kind + スコープ値。season/character は
    スコープキーで upsert、custom は常に新規作成
  - `GET /PUT /DELETE /me/tier-lists/:id`
  - `POST /DELETE /me/tier-lists/:id/share`
- 公開面は kind セグメントを廃止して id だけで引く:
  `GET /tier-lists/public`、`GET /tier-lists/:id`、
  `PUT/DELETE /tier-lists/:id/like`、`POST /tier-lists/:id/report`
- 共有は `/share/tier-lists/:token` の 1 ルート。旧の
  `/share/character-tier-lists`・`/share/custom-tier-lists` は作らない
- 旧ルートはすべて削除した。まだリリースしていないため、
  URL・クライアントの互換維持はしない

採らなかった案:

- **`POST /me/tier-lists` を常に upsert にする** — custom は同じ
  スコープ値（=id なし）で何枚も作れる必要がある。新規作成が
  既存表を上書きしないよう、custom だけ常に insert に分けた
- **公開面にも kind フィルタを残す** — 「みつける」は結合フィードを
  そのまま出す設計が既に成立しており、サーバ側の絞り込み要求が
  ない。必要になったら query で足せる

### mobile

- クエリ層は `tierListQueries` に集約。保存済み表のキーは
  `TierListScope`（`{kind:"season",season}` / `{kind:"character",annictWorkId}` /
  `{kind:"custom",id}`）で分け、シーズン切替や別作品でキャッシュが
  混ざらないようにする
- 編集画面は `app/tier-list.tsx` 1 画面に統合し、kind はルート
  パラメータで受ける（`?kind=character&workId=..` /
  `?kind=custom&id=..`、既定は season）。kind ごとの違いは
  「候補の出し方」だけなので、盤面・保存・共有の流れは共通のまま
- 共有 URL ビルダーも `buildTierListShareUrl` に統合
- `featureFlags.characterTierList` / `featureFlags.customTierList`
  （既定 false、`EXPO_PUBLIC_FEATURE_*` で有効化）で作成導線と
  一覧への出し分けを制御する。既定の Release ビルドではシーズン版
  だけが作成・表示できる

採らなかった案:

- **kind ごとに画面を残して内部だけ共通化する** — 3 画面分の
  導線・パラメータ・テストID を維持するコストが残る。未リリースなので
  画面統合まで行った
- **一覧 API を kind ごとに呼び分ける** — サーバが 1 モデルなら
  クライアントも 1 クエリで足りる。`useMyTierLists` で全件取り、
  フラグ無効の kind は `useMergedTierLists` 側で除く

## 前提が変わったとき

- **character / custom を既定公開するとき** — featureFlags の既定値を
  true にするだけで導線・一覧・編集画面が有効になる。API・DB に
  追加作業はない
- **新しい kind を足すとき** — `tier_lists.kind` の CHECK・部分ユニーク
  インデックス・スコープ値・`TierListScope`・`isTierListKindEnabled`・
  候補ソースの 6 点に追従が要る。テーブル・ルート・画面は増やさない
- **移行をロールバックするとき** — 0047 は非可逆（旧テーブルは
  DROP）。戻す場合は 0047 適用前のバックアップからの復元になる。
  デプロイ前の D1 スナップショット確認は migrations.md の手順どおり
