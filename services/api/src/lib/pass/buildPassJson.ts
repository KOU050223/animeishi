// Apple Wallet の pass.json を組み立てる純粋関数。
// 署名(PKCS#7)は上位層で行う。ここは仕様に基づく JSON 構造化のみに責務を絞る。
// 参考: https://developer.apple.com/documentation/walletpasses/pass

export type MeishiPassInput = {
  // Pass Type ID (Apple Developer で発行した pass.<reverse-domain>)。
  passTypeIdentifier: string;
  // Team ID (Apple Developer アカウントの 10 桁英数字)。
  teamIdentifier: string;
  // pass ごとに一意の ID。ユーザー ID + タイムスタンプ等で衝突しない値を渡す。
  serialNumber: string;
  // 名刺に載せる情報。
  username: string;
  bio?: string | null;
  favoriteQuote?: string | null;
  // 名刺公開 URL。Wallet の裏面リンクや QR に使う。
  profileUrl?: string | null;
};

// generic な "storeCard" スタイルを使う。名刺は会員証に近いフォーマットで表示できる。
export function buildMeishiPassJson(input: MeishiPassInput) {
  const primaryFields = [
    {
      key: "username",
      label: "USERNAME",
      value: input.username,
    },
  ];

  const secondaryFields = input.bio
    ? [
        {
          key: "bio",
          label: "BIO",
          value: input.bio,
        },
      ]
    : [];

  const auxiliaryFields = input.favoriteQuote
    ? [
        {
          key: "quote",
          label: "FAVORITE QUOTE",
          value: input.favoriteQuote,
        },
      ]
    : [];

  const backFields = input.profileUrl
    ? [
        {
          key: "profileUrl",
          label: "プロフィール",
          value: input.profileUrl,
        },
      ]
    : [];

  return {
    formatVersion: 1,
    passTypeIdentifier: input.passTypeIdentifier,
    teamIdentifier: input.teamIdentifier,
    serialNumber: input.serialNumber,
    organizationName: "Animeishi",
    description: `${input.username} の名刺`,
    // 色は名刺のブランドカラーに寄せる。将来的にユーザーテーマで差し替え可能。
    backgroundColor: "rgb(79, 70, 229)",
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: "rgb(226, 232, 240)",
    // 名刺は QR で共有する運用。プロフィール URL をエンコードする。
    barcodes: input.profileUrl
      ? [
          {
            format: "PKBarcodeFormatQR" as const,
            message: input.profileUrl,
            messageEncoding: "iso-8859-1" as const,
          },
        ]
      : undefined,
    storeCard: {
      primaryFields,
      secondaryFields,
      auxiliaryFields,
      backFields,
    },
  } as const;
}
