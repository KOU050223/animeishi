INSERT INTO anime_titles (title, title_reading, title_english, year, season, genres, thumbnail_url, created_at, updated_at)
SELECT '進撃の巨人', 'しんげきのきょじん', 'Attack on Titan', 2013, 'spring', '["アクション","ダーク","ファンタジー"]', NULL, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM anime_titles WHERE title = '進撃の巨人');

INSERT INTO anime_titles (title, title_reading, title_english, year, season, genres, thumbnail_url, created_at, updated_at)
SELECT '鬼滅の刃', 'きめつのやいば', 'Demon Slayer', 2019, 'spring', '["アクション","歴史","超自然"]', NULL, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM anime_titles WHERE title = '鬼滅の刃');

INSERT INTO anime_titles (title, title_reading, title_english, year, season, genres, thumbnail_url, created_at, updated_at)
SELECT '僕のヒーローアカデミア', 'ぼくのひーろーあかでみあ', 'My Hero Academia', 2016, 'spring', '["アクション","学園","超能力"]', NULL, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM anime_titles WHERE title = '僕のヒーローアカデミア');

INSERT INTO anime_titles (title, title_reading, title_english, year, season, genres, thumbnail_url, created_at, updated_at)
SELECT '呪術廻戦', 'じゅじゅつかいせん', 'Jujutsu Kaisen', 2020, 'fall', '["アクション","ダーク","超自然"]', NULL, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM anime_titles WHERE title = '呪術廻戦');

INSERT INTO anime_titles (title, title_reading, title_english, year, season, genres, thumbnail_url, created_at, updated_at)
SELECT 'HUNTER×HUNTER', 'はんたーはんたー', 'Hunter x Hunter', 2011, 'fall', '["アクション","アドベンチャー","ファンタジー"]', NULL, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM anime_titles WHERE title = 'HUNTER×HUNTER');

INSERT INTO anime_titles (title, title_reading, title_english, year, season, genres, thumbnail_url, created_at, updated_at)
SELECT 'ワンピース', 'わんぴーす', 'One Piece', 1999, 'fall', '["アクション","アドベンチャー","コメディ"]', NULL, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM anime_titles WHERE title = 'ワンピース');

INSERT INTO anime_titles (title, title_reading, title_english, year, season, genres, thumbnail_url, created_at, updated_at)
SELECT 'NARUTO -ナルト-', 'なると', 'Naruto', 2002, 'fall', '["アクション","アドベンチャー","少年"]', NULL, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM anime_titles WHERE title = 'NARUTO -ナルト-');

INSERT INTO anime_titles (title, title_reading, title_english, year, season, genres, thumbnail_url, created_at, updated_at)
SELECT '鋼の錬金術師 BROTHERHOOD', 'はがねのれんきんじゅつしぶらざーふっど', 'Fullmetal Alchemist: Brotherhood', 2009, 'spring', '["アクション","アドベンチャー","ダーク"]', NULL, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM anime_titles WHERE title = '鋼の錬金術師 BROTHERHOOD');

INSERT INTO anime_titles (title, title_reading, title_english, year, season, genres, thumbnail_url, created_at, updated_at)
SELECT 'SPY×FAMILY', 'すぱいふぁみりー', 'Spy x Family', 2022, 'spring', '["アクション","コメディ","日常"]', NULL, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM anime_titles WHERE title = 'SPY×FAMILY');

INSERT INTO anime_titles (title, title_reading, title_english, year, season, genres, thumbnail_url, created_at, updated_at)
SELECT '推しの子', 'おしのこ', 'Oshi no Ko', 2023, 'spring', '["ドラマ","ミステリー","芸能"]', NULL, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM anime_titles WHERE title = '推しの子');
