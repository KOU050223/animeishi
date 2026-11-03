-- 退会理由の匿名記録（issue #426）
--
-- 退会フローで任意入力された理由（複数選択＋自由記述）を、退会後も
-- 集計できるよう users とは別テーブルに保存する。個人を特定できる列
-- （user_id・メール等）は持たせない。POST /me/deletion-feedback が
-- 書き込み、削除本体（DELETE /me）とは分離しているため保存失敗が
-- 退会をブロックしない。

CREATE TABLE `deletion_feedbacks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  -- 選択理由キーの JSON 配列（キーはクライアント側で管理する）。
  `reasons` text NOT NULL,
  `free_text` text,
  `created_at` integer NOT NULL
);
