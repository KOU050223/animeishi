#!/usr/bin/env node
// App Store 審査のデモアカウント兼 Expo Explore のログイン用アカウント（ゲスト
// アカウント）を本番に用意する運営用スクリプト。通常は Taskfile 経由で実行する:
//   pnpm task review-account:seed
//
// 何度実行しても同じ状態に収束する（冪等）。やること:
//   1. Clerk にゲストアカウントとフレンド役アカウントを作る（既存ならパスワードを合わせる）
//   2. 本番 API にプロフィール・お気に入り・評価・作品リスト・ティア表を入れる
//   3. 2 つのアカウントをフレンドにする
//
// 名刺は端末内（AsyncStorage）保存、視聴履歴は Annict 連携が正なので、ここでは入れない。
//
// 環境変数（apps/api/.env か実行シェルで渡す。値はログに出さない）:
//   CLERK_SECRET_KEY         必須。本番は sk_live_
//   REVIEW_ACCOUNT_EMAIL     必須。ゲストアカウントのメールアドレス
//   REVIEW_ACCOUNT_PASSWORD  必須。ゲストアカウントのパスワード（審査・Explore に渡すもの）。
//                            32 文字以上のランダム文字列（例: openssl rand -base64 33）
//   REVIEW_FRIEND_EMAIL      必須。フレンド役アカウントのメールアドレス（ログインには使わない）
//   API_URL                  省略可。既定は本番 API
//   CLERK_PUBLISHABLE_KEY    省略可。既定は本番の pk_live（Frontend API のホスト名を取り出す）

import { randomBytes } from "node:crypto";

const DEFAULT_API_URL = "https://animeishi-api.uomi.dev";
const DEFAULT_PUBLISHABLE_KEY = "pk_live_Y2xlcmsuYW5pbWVpc2hpLnVvbWkuZGV2JA";
const CLERK_BACKEND = "https://api.clerk.com/v1";

// デモアカウントは API（POST /auth/demo-sign-in）経由で Device Trust を通らずに
// サインインできる。その試行回数制限は Cloudflare の拠点ごとにしか効かないため、
// 総当たりへの耐性はパスワード長で担保する。
const MIN_REVIEW_PASSWORD_LENGTH = 32;

// 本番と preview の両方の D1（annict_works）にキャッシュ済みの作品だけを使う。
// 未キャッシュの作品は Annict トークン無しでは登録できず、preview で予行演習
// できなくなるため、ここに足すときは両方の D1 にあるか確かめる。
const WORKS = {
  bocchi: 8128, // ぼっち・ざ・ろっく！
  spyFamily: 9060, // SPY×FAMILY
  lycoris: 9250, // リコリス・リコイル
  hyouka: 1808, // 氷菓
  shirobako: 4168, // SHIROBAKO
  euphonium: 4308, // 響け！ユーフォニアム
  madeInAbyss: 5121, // メイドインアビス
  nichijou: 1540, // 日常
};

const ACCOUNTS = {
  review: {
    clerkUsername: "animeishi_demo",
    profile: {
      username: "アニ名刺デモ",
      bio: "App Store 審査用のデモアカウントです。名刺・ティア表・作品リストを試せます。",
      favoriteQuote: "好きなものを、好きと言える場所。",
      selectedGenres: ["日常系", "SF", "音楽", "ドラマ"],
      isPublic: true,
    },
    favorites: [
      WORKS.bocchi,
      WORKS.hyouka,
      WORKS.euphonium,
      WORKS.spyFamily,
      WORKS.shirobako,
    ],
    ratings: [
      [WORKS.bocchi, "great"],
      [WORKS.hyouka, "great"],
      [WORKS.euphonium, "great"],
      [WORKS.shirobako, "good"],
      [WORKS.spyFamily, "good"],
    ],
    workLists: [
      {
        title: "はじめての人に勧めたい作品",
        description: "アニメをあまり見ない友だちにまず勧める 5 本。",
        isPublic: true,
        items: [
          WORKS.bocchi,
          WORKS.spyFamily,
          WORKS.hyouka,
          WORKS.madeInAbyss,
          WORKS.nichijou,
        ],
      },
      {
        title: "仕事がんばりたいときに見る",
        description: null,
        isPublic: false,
        items: [WORKS.shirobako, WORKS.euphonium],
      },
    ],
    tierList: {
      season: "2022-autumn",
      title: "2022 年秋の推し",
      description: "シーズンをまたいだ好きな作品も入れています。",
      isPublic: true,
      tiers: [
        { key: "s", label: "S", color: "#ef4444" },
        { key: "a", label: "A", color: "#f59e0b" },
        { key: "b", label: "B", color: "#10b981" },
      ],
      items: [
        { annictWorkId: WORKS.bocchi, tierKey: "s" },
        { annictWorkId: WORKS.lycoris, tierKey: "a" },
        { annictWorkId: WORKS.spyFamily, tierKey: "a" },
        { annictWorkId: WORKS.nichijou, tierKey: "b" },
      ],
    },
  },
  friend: {
    clerkUsername: "animeishi_demo_friend",
    profile: {
      username: "デモのフレンド",
      bio: "デモアカウントのフレンド表示を確認するためのアカウントです。",
      favoriteQuote: "冒険はまだ終わらない。",
      selectedGenres: ["ファンタジー", "アドベンチャー"],
      isPublic: true,
    },
    favorites: [WORKS.madeInAbyss, WORKS.lycoris, WORKS.nichijou],
    ratings: [[WORKS.madeInAbyss, "great"]],
    workLists: [],
    tierList: null,
  },
};

function usage() {
  return `使い方: node scripts/review-account.mjs

必要な環境変数: CLERK_SECRET_KEY, REVIEW_ACCOUNT_EMAIL, REVIEW_ACCOUNT_PASSWORD, REVIEW_FRIEND_EMAIL
（詳細はこのファイル先頭のコメントと docs/runbook/production-tasks.md）`;
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`環境変数 ${name} が未設定です\n\n${usage()}`);
  return value;
}

function frontendApiHost(publishableKey) {
  const encoded = publishableKey.replace(/^pk_(live|test)_/, "");
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  return decoded.replace(/\$$/, "");
}

async function request(url, init, label) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    const error = new Error(
      `${label} が失敗しました (${res.status}): ${detail.slice(0, 500)}`,
    );
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return body;
}

function clerkBackend(secretKey) {
  return (path, { method = "GET", body } = {}) =>
    request(
      `${CLERK_BACKEND}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${secretKey}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      `Clerk ${method} ${path.split("?")[0]}`,
    );
}

// メールアドレスで Clerk ユーザーを探し、無ければ作る。あればパスワードを合わせる。
async function ensureClerkUser(clerk, { email, password, username, role }) {
  const found = await clerk(
    `/users?email_address=${encodeURIComponent(email)}`,
  );
  const metadata = { public_metadata: { demoAccount: role } };
  if (Array.isArray(found) && found.length > 0) {
    const user = found[0];
    await clerk(`/users/${user.id}`, {
      method: "PATCH",
      body: { password, skip_password_checks: true, ...metadata },
    });
    console.log(`  Clerk: 既存ユーザーを更新 (${role})`);
    return user.id;
  }
  const user = await clerk("/users", {
    method: "POST",
    body: {
      email_address: [email],
      username,
      password,
      skip_password_checks: true,
      ...metadata,
    },
  });
  console.log(`  Clerk: ユーザーを作成 (${role})`);
  return user.id;
}

// sign-in token（ticket）で Frontend API にサインインしてセッションを作り、
// 以後のセッション JWT は Backend API で都度発行する（JWT の寿命が短いため）。
async function openSession(clerk, fapiHost, userId) {
  const { token } = await clerk("/sign_in_tokens", {
    method: "POST",
    body: { user_id: userId, expires_in_seconds: 300 },
  });
  const result = await request(
    `https://${fapiHost}/v1/client/sign_ins?_is_native=1`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ strategy: "ticket", ticket: token }),
    },
    "Clerk ticket サインイン",
  );
  const sessionId =
    result?.response?.created_session_id ??
    result?.client?.last_active_session_id;
  if (!sessionId)
    throw new Error("Clerk ticket サインインでセッションが作られませんでした");
  return async () => {
    const { jwt } = await clerk(`/sessions/${sessionId}/tokens`, {
      method: "POST",
      body: {},
    });
    return jwt;
  };
}

function apiClient(apiUrl, getJwt) {
  return async (method, path, body) =>
    request(
      `${apiUrl}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${await getJwt()}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      `API ${method} ${path}`,
    );
}

// 既定のデモデータを追加・更新する。同じタイトルの作品リストとティア表は上書きするが、
// 審査員などが後から追加したお気に入り・リストは消さない（完全な初期化ではない）。
// 戻り値は Explore の parameters に使う公開リストの ID。
async function seedAccount(api, spec) {
  const ids = { publicWorkListId: null, tierListId: null };
  await api("PUT", "/me/profile", spec.profile);
  console.log("  プロフィール");

  for (const id of spec.favorites) await api("POST", `/me/favorites/${id}`);
  console.log(`  お気に入り ${spec.favorites.length} 件`);

  for (const [id, rating] of spec.ratings)
    await api("PUT", `/me/work-ratings/${id}`, { rating });
  console.log(`  評価 ${spec.ratings.length} 件`);

  if (spec.workLists.length > 0) {
    const existing = await api("GET", "/me/work-lists");
    const lists = Array.isArray(existing)
      ? existing
      : (existing?.workLists ?? []);
    for (const list of spec.workLists) {
      const body = {
        ...list,
        items: list.items.map((annictWorkId) => ({ annictWorkId })),
      };
      const same = lists.find((l) => l.title === list.title);
      const saved = same
        ? await api("PUT", `/me/work-lists/${same.id}`, body)
        : await api("POST", "/me/work-lists", body);
      if (list.isPublic && ids.publicWorkListId === null) {
        ids.publicWorkListId = saved?.id ?? same?.id ?? null;
      }
    }
    console.log(`  作品リスト ${spec.workLists.length} 件`);
  }

  if (spec.tierList) {
    const saved = await api("PUT", "/me/tier-lists", spec.tierList);
    ids.tierListId = saved?.id ?? null;
    console.log("  ティア表");
  }
  return ids;
}

async function makeFriends(reviewApi, friendApi, reviewUserId) {
  let sent;
  try {
    sent = await friendApi("POST", "/me/friend-requests", {
      userId: reviewUserId,
    });
  } catch (error) {
    // 既にフレンドなら 409 が返る（2 回目以降の実行）。
    if (error.status === 409) {
      console.log("  フレンド: 成立済み");
      return;
    }
    throw error;
  }
  if (sent?.status === "accepted") {
    console.log("  フレンド: 成立済み");
    return;
  }
  const { received = [] } =
    (await reviewApi("GET", "/me/friend-requests")) ?? {};
  const request =
    received.find((r) => r.id === sent?.request?.id) ?? received[0];
  if (!request) {
    console.log("  フレンド: 申請が見つからないため成立済みとみなす");
    return;
  }
  await reviewApi("POST", `/me/friend-requests/${request.id}/accept`);
  console.log("  フレンド: 申請を承認");
}

async function main() {
  if (process.argv.includes("-h") || process.argv.includes("--help")) {
    console.log(usage());
    return;
  }
  const secretKey = requireEnv("CLERK_SECRET_KEY");
  const reviewEmail = requireEnv("REVIEW_ACCOUNT_EMAIL");
  const reviewPassword = requireEnv("REVIEW_ACCOUNT_PASSWORD");
  const friendEmail = requireEnv("REVIEW_FRIEND_EMAIL");
  if (reviewPassword.length < MIN_REVIEW_PASSWORD_LENGTH) {
    throw new Error(
      `REVIEW_ACCOUNT_PASSWORD は ${MIN_REVIEW_PASSWORD_LENGTH} 文字以上のランダム文字列にしてください（例: openssl rand -base64 33）`,
    );
  }
  const apiUrl = (process.env.API_URL?.trim() || DEFAULT_API_URL).replace(
    /\/$/,
    "",
  );
  const fapiHost = frontendApiHost(
    process.env.CLERK_PUBLISHABLE_KEY?.trim() || DEFAULT_PUBLISHABLE_KEY,
  );

  const live = secretKey.startsWith("sk_live_");
  if (live !== (fapiHost === frontendApiHost(DEFAULT_PUBLISHABLE_KEY))) {
    throw new Error(
      "CLERK_SECRET_KEY と CLERK_PUBLISHABLE_KEY のインスタンス（live/test）が一致しません",
    );
  }
  console.log(
    `対象: ${apiUrl}（Clerk ${live ? "本番" : "開発"}インスタンス ${fapiHost}）`,
  );

  const clerk = clerkBackend(secretKey);
  // フレンド役は人がログインしないので、毎回ランダムなパスワードにする。
  const friendPassword = randomBytes(24).toString("base64url");

  console.log("ゲストアカウント");
  const reviewUserId = await ensureClerkUser(clerk, {
    email: reviewEmail,
    password: reviewPassword,
    username: ACCOUNTS.review.clerkUsername,
    role: "review",
  });
  const reviewApi = apiClient(
    apiUrl,
    await openSession(clerk, fapiHost, reviewUserId),
  );
  const reviewIds = await seedAccount(reviewApi, ACCOUNTS.review);

  console.log("フレンド役アカウント");
  const friendUserId = await ensureClerkUser(clerk, {
    email: friendEmail,
    password: friendPassword,
    username: ACCOUNTS.friend.clerkUsername,
    role: "friend",
  });
  const friendApi = apiClient(
    apiUrl,
    await openSession(clerk, fapiHost, friendUserId),
  );
  await seedAccount(friendApi, ACCOUNTS.friend);
  await makeFriends(reviewApi, friendApi, reviewUserId);

  console.log(`\n完了。ゲストアカウントのユーザー ID: ${reviewUserId}`);
  console.log(
    "\nExpo Explore の parameters（apps/mobile/.expo-explore/config.yaml）に使う値:",
  );
  console.log(`  /user/[uid]          uid: ${friendUserId}`);
  console.log(`  /public-work-list    id: ${reviewIds.publicWorkListId}`);
  console.log(
    `  /public-tier-list    kind: season, id: ${reviewIds.tierListId}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
