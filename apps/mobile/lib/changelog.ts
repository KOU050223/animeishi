// /changelog 画面（app/changelog.tsx）に表示する静的データ。
// 機能一覧・更新情報・今後の予定をここで管理し、追記は各配列への追記で済ませる。
// 文言は日本語固定（support.tsx / LegalDocument と同じく i18n 対象外）。

/** 「このアプリでできること」の 1 項目。 */
export type FeatureItem = {
  title: string;
  description: string;
};

/** 「更新情報」の 1 エントリ。新しいものを先頭に並べる。 */
export type ChangelogEntry = {
  /** 表示用の日付（例: "2026年10月15日"）。 */
  date: string;
  title: string;
  /** 補足説明（任意）。 */
  description?: string;
};

/** 「今後追加したい機能」の 1 項目。issue は対応する GitHub issue 番号。 */
export type PlannedFeature = {
  title: string;
  /** GitHub issue 番号。タップで issue を開く導線に使う。 */
  issue?: number;
};

// 現状ユーザーが使える機能。未提供の機能（Apple Wallet 追加などフラグ未満のもの）は
// ここには書かず PLANNED_FEATURES 側に置く。
export const FEATURES: FeatureItem[] = [
  {
    title: "アニメ名刺の作成",
    description:
      "テンプレートを選んでテキスト・画像・QRコードを自由に配置し、自分だけの名刺をデザインできます。",
  },
  {
    title: "QRコードで名刺交換",
    description:
      "相手のQRコードを読み取るだけで名刺を交換できます。交換した相手はフレンドリストに登録されます。",
  },
  {
    title: "Annict 連携",
    description:
      "Annict と連携すると、作品検索や「見てる・見た・見たい」などの視聴ステータス管理ができます。",
  },
  {
    title: "視聴履歴・お気に入り",
    description:
      "視聴した作品を記録・管理したり、お気に入り作品を登録したりできます。",
  },
  {
    title: "シーズン Tier 表",
    description:
      "クールごとの作品を Tier にドラッグして振り分けられます。完成した Tier 表は画像や共有 URL で共有できます。",
  },
  {
    title: "公開プロフィール",
    description:
      "名刺の公開 URL から、自分のプロフィールページを共有できます。",
  },
  {
    title: "dアニメストアの視聴履歴取り込み（Web 版）",
    description:
      "dアニメストアの視聴履歴を取り込み、Annict の視聴ステータスに反映できます。",
  },
  {
    title: "通報・ブロック",
    description:
      "不適切なユーザーを通報・ブロックできます。ブロック中のユーザーはプロフィール画面から管理できます。",
  },
];

// 更新履歴。日付単位でまとめ、新しいものを先頭に追加する。
// 内部的な変更（CI・リファクタ等）はユーザーに関係しないため含めない。
export const UPDATES: ChangelogEntry[] = [
  {
    date: "2026年10月15日",
    title: "アニメ一覧のシーズン選択を強化しました",
    description:
      "年をピッカーで選べるようになり、選択できるシーズンの範囲を広げました。あわせて Tier 表でドラッグ中のカードが他のカードの裏に隠れる問題を修正しています。",
  },
  {
    date: "2026年10月13日",
    title: "dアニメストアの視聴履歴取り込みを Web 版限定の機能に変更しました",
  },
  {
    date: "2026年10月11日",
    title: "Tier 表を画像・共有 URL でエクスポートできるようになりました",
    description:
      "Tier 名を自由な文字に変更できるようにもなりました。あわせてユーザーの通報・ブロック機能、アカウント削除、プライバシーポリシー・利用規約・サポートページを追加しています。",
  },
  {
    date: "2026年9月27日",
    title:
      "dアニメストアの視聴履歴を Annict に取り込めるようになりました（Web 版）",
  },
  {
    date: "2026年9月26日",
    title: "シーズンごとのアニメ Tier 表を追加しました",
  },
  {
    date: "2026年7月23日",
    title: "アニメ検索を高速化しました",
  },
  {
    date: "2026年7月2日",
    title: "名刺エディタを追加しました",
    description: "テンプレートやテキスト・画像などの要素を自由に配置できます。",
  },
  {
    date: "2026年7月1日",
    title: "アニメを年・シーズンで絞り込んで検索できるようになりました",
    description: "初期表示に今期のアニメを表示します。",
  },
  {
    date: "2026年6月24日",
    title: "公開プロフィールページを追加しました",
  },
  {
    date: "2026年6月23日",
    title: "お気に入り・フレンド・QR での名刺交換を追加しました",
  },
];

// issue 番号は GitHub（KOU050223/animeishi）の open issue と対応させている。
export const PLANNED_FEATURES: PlannedFeature[] = [
  { title: "ダークモード対応", issue: 171 },
  { title: "下部タブの整理", issue: 170 },
  { title: "キャラクターの Tier 表", issue: 169 },
  { title: "Tier 表の未分類へ作品を手動追加", issue: 168 },
  { title: "スマホでの Tier 表のドラッグ改善", issue: 167 },
  { title: "パスキーでのログイン", issue: 181 },
  { title: "Google でのログイン", issue: 89 },
  { title: "名刺の画像挿入の強化", issue: 96 },
  { title: "Apple Wallet への名刺追加", issue: 81 },
];
