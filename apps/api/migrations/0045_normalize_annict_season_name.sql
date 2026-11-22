-- annict_works.season_name を Annict GraphQL の enum（"AUTUMN" 等）から
-- 今期判定・シーズン表示が前提とする "<年>-<シーズン>" 形式（"2026-autumn"）に揃える。
-- 新規の書き込みは Annict クライアント（normalizeAnnictSeasonName）で同じ形式になる。
UPDATE annict_works
SET season_name = season_year || '-' || lower(season_name)
WHERE season_name IN ('WINTER', 'SPRING', 'SUMMER', 'AUTUMN')
  AND season_year IS NOT NULL;
