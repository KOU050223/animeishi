# PR3 受け入れ基準：Clerk認証とプロフィールAPI

## 概要
Hono の Clerk JWT 検証ミドルウェアを追加し、認証済みユーザーが自分のプロフィールを取得・更新できる API を実装する。

---

## 受け入れ基準

### AC-1: 未認証アクセスを拒否する
- [ ] `Authorization` ヘッダーなしで `GET /me/profile` を呼ぶと **401 Unauthorized** が返る
- [ ] `Authorization` ヘッダーなしで `PUT /me/profile` を呼ぶと **401 Unauthorized** が返る
- [ ] `userId` が null の場合（無効な JWT）も **401** が返る

### AC-2: GET /me/profile
- [ ] 認証済みユーザーが自分のプロフィールを取得できる
- [ ] プロフィールが未作成の場合は **404** が返る

### AC-3: PUT /me/profile（upsert）
- [ ] 認証済みユーザーが `username`, `bio`, `isPublic` などを送ると **200** が返り、プロフィールが作成される
- [ ] 既存プロフィールがある場合は更新される
- [ ] `selectedGenres` を送ると `user_genres` テーブルに保存される
- [ ] `username` が空文字の場合は **400 Bad Request** が返る（Zod バリデーション）

### AC-4: AppType の型安全性
- [ ] `packages/contracts` 経由で `AppType` がエクスポートされており、モバイル側から `hc<AppType>()` で型安全に呼び出せる

---

## テスト実行

```bash
pnpm --filter @animeishi/api test
```

期待結果: **24 tests passed**（`authorizedDb.test.ts` 16件 + `me.test.ts` 8件）

---

## 実装ファイル

| ファイル | 役割 |
|---------|------|
| `services/api/src/middleware/auth.ts` | `requireAuth` ミドルウェア（Clerk JWT 検証） |
| `services/api/src/routes/me.ts` | `GET /me/profile`, `PUT /me/profile` |
| `services/api/src/index.ts` | `/me` ルートのマウント |
| `packages/contracts/src/index.ts` | `AppType` の re-export |

## 環境変数（wrangler.toml / Cloudflare Bindings）

| 変数名 | 用途 |
|-------|------|
| `CLERK_SECRET_KEY` | Clerk JWT 検証に使用 |
| `CLERK_PUBLISHABLE_KEY` | Clerk クライアント初期化に使用 |
