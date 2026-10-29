// (auth) でパスキー登録促進を表示中であることを AuthGuard へ伝えるフラグ
// （issue #326）。
// 促進はサインアップ完了（setActive 済み = サインイン済み）後に出すため、
// 表示中は「isSignedIn=true かつ (auth) にいる」という AuthGuard が
// ホームへ追い出す条件に一致してしまう。フラグを setActive より先に立てれば
// ガードの effect の発火順に関わらず追い出しを止められる。
// sign-up 側は促進が終わるまで true のままにし、必ず画面側で false に戻す。
export const passkeyPromptPending = { current: false };
