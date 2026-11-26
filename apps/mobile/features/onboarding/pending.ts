// サインアップ完了直後にオンボーディングへ進む途中であることを伝えるフラグ
// （issue #412）。passkeyPromptPending（issue #326）と同じ仕組み。
//
// サインアップ完了（finalize）で isSignedIn が立つと AuthGuard の
// 「サインイン済みは (auth) からホームへ」が発火し、画面側が明示した
// /onboarding への遷移と競合する。finalize より先に立てればガードの
// effect の発火順に関わらず追い出しを止められる。
// オンボーディング画面はこのフラグが立っているときだけ描画し、
// 終了（完了/スキップ）時に必ず false に戻す。
export const onboardingPending = { current: false };
