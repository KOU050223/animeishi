// error_handler.dart から移植したエラーメッセージ辞書

export const AuthErrors: Record<string, string> = {
  "user-not-found": "このメールアドレスのアカウントは存在しません",
  "wrong-password": "パスワードが間違っています",
  "email-already-in-use": "このメールアドレスは既に使用されています",
  "weak-password": "パスワードが弱すぎます。8文字以上で設定してください",
  "invalid-email": "無効なメールアドレスです",
  "user-disabled": "このアカウントは無効化されています",
  "too-many-requests": "ログイン試行回数が上限に達しました。しばらくしてから再試行してください",
  "operation-not-allowed": "この認証方法は許可されていません",
  "invalid-credential": "認証情報が無効です",
  "account-exists-with-different-credential": "別の認証方法で登録されたアカウントが存在します",
  "requires-recent-login": "この操作には再ログインが必要です",
  "credential-already-in-use": "この認証情報は既に別のアカウントで使用されています",
  "network-request-failed": "ネットワーク接続を確認してください",
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
