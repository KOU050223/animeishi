-- 名刺交換後のお礼の取り消しを論理削除にする列追加（issue #694）
--
-- 送り手の取り消しを物理削除していたが、それだと「取り消して再送」で
-- 1 日 1 通（日本時間の暦日。NOT EXISTS 挿入）の制限をすり抜けられる。
-- 取り消しは deleted_at を立てて両者の一覧から隠すだけにし、行は残して
-- 同日判定にも数える。解除・ブロック・退会時の当事者削除は物理削除の
-- まま（deleteFriendThanksBetween 等）。

ALTER TABLE `friend_thanks` ADD `deleted_at` integer;
