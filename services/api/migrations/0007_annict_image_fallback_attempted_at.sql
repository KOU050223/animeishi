-- 画像フォールバック解決の最終試行時刻（クールダウン用）（issue #127）。
--
-- image fallback のジョブは「image_source が立つまで未解決」としか判別できない。
-- cron が annict_works の未解決行を直接回して解決する設計で、AniList / Jikan が
-- 429 等で解決できなかった作品が毎回の実行で叩き直されないよう、試行時刻を記録して
-- クールダウン期間内は対象外にする。解決時（updateResolvedImage）または
-- mal_anime_id 変化時にクリアする。

ALTER TABLE `annict_works` ADD COLUMN `image_fallback_attempted_at` integer;
