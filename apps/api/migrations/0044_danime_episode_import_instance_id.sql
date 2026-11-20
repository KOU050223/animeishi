-- 実行中ジョブがどの Workflow インスタンスに処理されているかを追跡する列追加（issue #701）
--
-- 引き継ぎインスタンスは job.id とは別の ID で起動されるため、進捗参照が
-- job.id のインスタンス（= 初回インスタンス）だけを見る構造だと、
-- 引き継ぎ先が Errored になったときジョブが実行中のまま残ってしまう。
-- 各インスタンスは起動時に自分の ID をこの列へ書き込み、
-- 進捗参照・新規作成時の調停はここを見る。
-- NULL はこの列追加前のジョブで、従来どおり job.id のインスタンスを見る。

ALTER TABLE `danime_episode_import_jobs` ADD `workflow_instance_id` text;
