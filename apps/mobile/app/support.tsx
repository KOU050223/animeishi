import { LegalDocument, type LegalSection } from "@/components/LegalDocument";

// TODO(issue #133): 問い合わせ窓口のメールアドレスが確定したらプレースホルダを差し替える。
const CONTACT_EMAIL = "{{CONTACT_EMAIL}}";

// ストア掲載のサポート URL（https://animeishi.uomi.dev/support）として公開するページ。
// 回答は apps/mobile の実画面・実機能と照合して書くこと。未実装の案内は書かない。
const SECTIONS: LegalSection[] = [
  {
    heading: "Q. 視聴履歴や作品検索が使えません",
    paragraphs: [
      "視聴履歴の表示・更新と作品検索には Annict との連携が必要です。サインイン後、プロフィールタブの「Annict 連携」カードから Annict アカウントと連携してください。",
    ],
  },
  {
    heading: "Q. 名刺を交換できません",
    paragraphs: [
      "QR タブの「マイQR」に表示されるコードを相手の「スキャン」で読み取ると名刺を交換できます。QR コードの表示にはサインインが必要です。",
    ],
  },
  {
    heading: "Q. dアニメストアの視聴履歴を取り込めません",
    paragraphs: [
      "視聴履歴の取り込みは Web 版（https://animeishi.uomi.dev）でのみ利用できます。Web 版にサインイン後、視聴履歴画面の「dアニメからインポート」から取り込み画面を開き、案内に従ってブックマークレットをブラウザのブックマークバーに登録してください。dアニメストアの視聴履歴ページでログインした状態でそのブックマークを実行すると、抽出結果が自動で転送されます。転送に失敗した場合は結果がクリップボードにコピーされるので、取り込み画面の貼り付け欄に貼って進んでください。取り込んだ作品は Annict の視聴ステータスに反映されます。",
    ],
  },
  {
    heading: "Q. アカウントやデータを削除したいです",
    paragraphs: [
      "サインイン後、プロフィール画面の「アカウントを削除」から削除できます。名刺・視聴履歴・お気に入り・フレンド・Tier表など、すべてのデータが削除され、この操作は取り消せません。",
    ],
  },
  {
    heading: "お問い合わせ",
    paragraphs: [
      "上記で解決しない場合は、以下の連絡先までお問い合わせください。",
      `連絡先: ${CONTACT_EMAIL}`,
    ],
  },
];

export default function SupportScreen() {
  return (
    <LegalDocument
      title="サポート"
      effectiveDate="最終更新: 2026年10月13日"
      sections={SECTIONS}
    />
  );
}
