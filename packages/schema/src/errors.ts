// Clerk エラーコード → 日本語メッセージ辞書
// ref: https://clerk.com/docs/errors/frontend-api

export const AuthErrors: Record<string, string> = {
  // サインイン
  form_identifier_not_found: "このメールアドレスのアカウントは存在しません",
  form_password_incorrect: "パスワードが間違っています",
  user_locked: "ログイン試行回数が上限に達しました。しばらくしてから再試行してください",
  form_password_compromised: "このパスワードは安全でないため使用できません。別のパスワードを設定してください",
  // サインアップ
  form_email_conflict: "このメールアドレスは既に使用されています",
  form_invalid_email_address: "有効なメールアドレスを入力してください",
  form_password_not_strong_enough: "パスワードが弱すぎます。より複雑なパスワードを設定してください",
  form_invalid_password_length_too_short: "パスワードは8文字以上で入力してください",
  form_invalid_password_length_too_long: "パスワードは128文字以内で入力してください",
  form_password_no_lowercase: "パスワードには英小文字を含める必要があります",
  form_password_no_uppercase: "パスワードには英大文字を含める必要があります",
  form_password_no_number: "パスワードには数字を含める必要があります",
  form_password_no_special_char: "パスワードには記号を含める必要があります",
  // セッション
  session_reverification_required: "この操作には再ログインが必要です",
  authentication_invalid: "セッションが無効です。再度ログインしてください",
  _default: "認証エラーが発生しました。しばらくしてから再試行してください",
};

export const QRErrors: Record<string, string> = {
  invalid_format: "無効なQRコードです",
  self_scan: "自分のQRコードはスキャンできません",
  user_not_found: "このユーザーは存在しません",
  already_friend: "既にフレンドです",
  scan_failed: "QRコードの読み取りに失敗しました",
  camera_permission: "カメラの使用許可が必要です",
  _default: "QRコードの処理中にエラーが発生しました",
};

export const AnimeListErrors: Record<string, string> = {
  fetch_failed: "アニメリストの取得に失敗しました",
  save_failed: "アニメの保存に失敗しました",
  delete_failed: "アニメの削除に失敗しました",
  empty_selection: "アニメが選択されていません",
  too_many_selections: "選択できるアニメ数の上限に達しました",
  _default: "アニメリストの処理中にエラーが発生しました",
};

export const ProfileErrors: Record<string, string> = {
  update_failed: "プロフィールの更新に失敗しました",
  invalid_username: "ユーザー名が無効です",
  username_too_long: "ユーザー名が長すぎます（20文字以内で入力してください）",
  email_update_failed: "メールアドレスの更新に失敗しました",
  _default: "プロフィールの処理中にエラーが発生しました",
};

export function getAuthError(code: string): string {
  return AuthErrors[code] ?? AuthErrors._default;
}

export function getQRError(code: string): string {
  return QRErrors[code] ?? QRErrors._default;
}

export function getAnimeListError(code: string): string {
  return AnimeListErrors[code] ?? AnimeListErrors._default;
}

export function getProfileError(code: string): string {
  return ProfileErrors[code] ?? ProfileErrors._default;
}
