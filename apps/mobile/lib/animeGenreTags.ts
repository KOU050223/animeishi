const genreDefinitions: string[][] = [
  ["Action", "アクション"],
  ["Adventure", "冒険"],
  ["Anthropomorphic", "擬人化"],
  ["Avant Garde", "前衛"],
  ["Award Winning", "受賞作"],
  ["Boys Love", "ボーイズラブ", "BL", "Yaoi"],
  ["Comedy", "コメディ"],
  ["Crime", "犯罪"],
  ["Crossdressing", "女装・男装"],
  ["Dementia", "心理・実験"],
  ["Delinquents", "不良", "Delinquent"],
  ["Detective", "探偵"],
  ["Drama", "ドラマ"],
  ["Educational", "教育"],
  ["Fantasy", "ファンタジー"],
  ["Gag Humor", "ギャグ", "Gag"],
  ["Game", "ゲーム"],
  ["Girls Love", "ガールズラブ", "GL", "Yuri"],
  ["Gore", "ゴア"],
  ["Gourmet", "グルメ", "Food"],
  ["Harem", "ハーレム"],
  ["Hentai", "成人向け", "Erotica", "Ecchi"],
  ["High Stakes Game", "デスゲーム"],
  ["Historical", "歴史"],
  ["Horror", "ホラー"],
  ["Idols (Female)", "女性アイドル", "Idol"],
  ["Idols (Male)", "男性アイドル"],
  ["Isekai", "異世界"],
  ["Iyashikei", "癒やし系"],
  ["Josei", "女性向け"],
  ["Kids", "子ども向け", "Children"],
  ["Love Polygon", "恋愛群像"],
  ["Magical Girl", "魔法少女", "Mahou Shoujo"],
  ["Martial Arts", "格闘技"],
  ["Mecha", "ロボット"],
  ["Medical", "医療"],
  ["Military", "軍事"],
  ["Music", "音楽"],
  ["Mystery", "ミステリー"],
  ["Mythology", "神話"],
  ["Organized Crime", "組織犯罪"],
  ["Otaku Culture", "オタク文化"],
  ["Parody", "パロディ"],
  ["Performing Arts", "芸能"],
  ["Pets", "ペット"],
  ["Psychological", "心理"],
  ["Racing", "レース"],
  ["Reincarnation", "転生"],
  ["Reverse Harem", "逆ハーレム"],
  ["Romance", "恋愛"],
  ["Samurai", "侍"],
  ["School", "学園"],
  ["Sci-Fi", "SF", "Science Fiction", "Sci Fi"],
  ["Seinen", "青年向け"],
  ["Shoujo", "少女向け", "Shojo"],
  ["Shounen", "少年向け", "Shonen"],
  ["Showbiz", "芸能界"],
  ["Slice of Life", "日常"],
  ["Space", "宇宙"],
  ["Sports", "スポーツ"],
  ["Strategy Game", "戦略ゲーム"],
  ["Super Power", "超能力", "Superpower"],
  ["Supernatural", "超自然"],
  ["Survival", "サバイバル"],
  ["Suspense", "サスペンス"],
  ["Team Sports", "チームスポーツ"],
  ["Time Travel", "タイムトラベル"],
  ["Vampire", "吸血鬼"],
  ["Video Game", "ビデオゲーム"],
  ["Visual Arts", "美術"],
  ["Workplace", "職場"],
];

const normalized = (value: string) =>
  value.normalize("NFKC").trim().toLowerCase();
const canonicalByName = new Map<string, string>();
const japaneseByCanonical = new Map<string, string>();
const namesByCanonical = new Map<string, string[]>();

for (const [canonical, japanese, ...aliases] of genreDefinitions) {
  japaneseByCanonical.set(canonical, japanese);
  namesByCanonical.set(canonical, [canonical, japanese, ...aliases]);
  for (const name of [canonical, ...aliases]) {
    canonicalByName.set(normalized(name), canonical);
  }
}

export function canonicalAnimeGenre(name: string): string {
  return canonicalByName.get(normalized(name)) ?? name;
}

export function animeGenreJapaneseName(name: string): string {
  return japaneseByCanonical.get(canonicalAnimeGenre(name)) ?? name;
}

export function matchesAnimeGenreSearch(
  name: string,
  displayName: string,
  query: string,
): boolean {
  const needle = normalized(query);
  const canonical = canonicalAnimeGenre(name);
  return [displayName, ...(namesByCanonical.get(canonical) ?? [name])].some(
    (candidate) => normalized(candidate).includes(needle),
  );
}
