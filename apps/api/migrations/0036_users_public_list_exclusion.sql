-- 公開リストからの除外理由（issue #580）
--
-- みつける（Discover）の名刺・作品リスト・Tier 表、イベントの公開参加者
-- 一覧など、認証ユーザー全員に見える公開一覧に、審査用デモアカウントや
-- BAN されたアカウントを出さないための印。
-- NULL = 一覧に出す。値は除外の理由（demo / banned 等）で、一覧クエリは
-- NULL 判定だけに使い値自体は読まない。運営が wrangler d1 execute や
-- scripts/review-account.mjs で直接書き込む運用のため、値の追加に
-- マイグレーションを要しないよう CHECK 制約は付けない。
-- 除外が効くのは公開一覧への露出だけで、名刺詳細・共有リンク・
-- フレンド一覧などの直接参照は変わらない（審査フローのデモデータを
-- 壊さないため）。

ALTER TABLE `users` ADD COLUMN `public_list_exclusion` text;
