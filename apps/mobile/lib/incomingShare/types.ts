/**
 * 画像ファイルの URI から読み取れた QR コードの文字列一覧を返す。
 * QR が見つからない場合は空配列。
 */
export type ScanQrFromImage = (uri: string) => Promise<string[]>;
