-- イベント参加の公開範囲（issue #440）。connpass 風の参加者一覧のために
-- 「参加する」表明の公開範囲を 3 段階で持つ:
--   'public'   誰のイベント詳細にも参加者一覧へ出る
--   'friends'  フレンドのイベント詳細の「参加しているフレンド」にだけ出る
--   'private'  本人以外には出ない（フェーズ 1 と同じ振る舞い）
-- 既定は 'private'。既存行は DEFAULT で 'private' になるため UPDATE しない。
ALTER TABLE `event_participations` ADD `visibility` text DEFAULT 'private' NOT NULL;
