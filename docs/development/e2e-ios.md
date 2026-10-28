# E2E テスト（Maestro / iOS シミュレーター）

E2E を初めて動かすとき、失敗の原因を調べるとき、`apps/mobile/scripts/e2e-ios.sh` を
変えるときに読む。実行コマンドと運用ルールはルートの AGENTS.md を参照。

Maestro による E2E を `apps/mobile/.maestro/` に置く。
第 1 弾の対象は認証ライフサイクル（サインアップ→ホーム→サインアウト→
サインイン→アカウント削除）で、`flows/auth-lifecycle.yaml` がエントリポイント。
`subflows/` は `runFlow` から呼ばれる部品なので直接実行しない。

E2E は CI では回さない（macOS ランナーのコストのため。issue #180）。

## 前提

- maestro CLI 1.39.0 以降: `brew install mobile-dev-inc/tap/maestro`
  （JDK も必要。subflows の `optional: true` を使うため 1.39.0 以降）
- Xcode + iOS シミュレーターランタイム
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`: **必ず pk_test**（Clerk 開発インスタンス、
  GitHub Variable `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY_PREVIEW` と同じ値）。
  未設定なら `apps/mobile/.env` を読む。pk_live はスクリプトが拒否する
- `EXPO_PUBLIC_API_URL`: 既定 `http://localhost:8787`。
  API（wrangler dev）が未起動ならスクリプトが起動し、終了時に停止する。
  アカウント削除は `DELETE /me` を叩くため API が必須（`apps/api/.dev.vars`
  に開発インスタンスの `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` が要る）
- ローカル D1 マイグレーション済みであること（`vp run @animeishi/api#db:migrate:local`。
  スクリプトが API 起動時に適用するが、API 常駐派は事前に回しておく）

> e2e-ios.sh は通常のシェル（vp が入れた node / pnpm が PATH にある状態）から
> そのまま xcodebuild 等を実行する。`CC` `SDKROOT` `DEVELOPER_DIR` などの
> toolchain 変数を export したシェルから叩くと xcodebuild のネイティブビルドが
> 壊れるので、その場合は変数を外してから実行する（旧 Nix devShell で起きた問題。
> スクリプト側の回避策は #252 で外した）。

## 環境変数

- `E2E_SKIP_BUILD=1` … ビルドをスキップ（既存の `ios/build/e2e-dd` を再利用。
  ネイティブキャッシュも読まない）
- `E2E_SIM_NAME` … 専用シミュレーター名を変更（既定 `animeishi-e2e-<ワークツリー名>`。
  指定したときは iOS 18.x 優先のランタイム選択を行わず、最新ランタイムで作成・
  同名の既存シミュレーターはランタイムを見ずに再利用する。特定の iOS 版で
  試したいときに使う）
- `E2E_HOST_LOCK_TIMEOUT` … ホストロックの待ち時間の上限（秒、既定 3600。
  超えるとエラーで終了）
- `E2E_NATIVE_CACHE=0` … ネイティブキャッシュを使わず必ずフルビルドする
  （キャッシュの読み込み・保存の両方をやめる。既定は `1`）
- `E2E_MAESTRO_ATTEMPTS` … ドライバ未接続系の失敗時に `maestro test` を
  実行する最大回数（既定 3。リトライ判定の詳細は「失敗の調査」を参照）
- `MAESTRO_DRIVER_STARTUP_TIMEOUT` … Maestro の iOS ドライバ
  （XCTest runner）の起動待ち時間（ミリ秒）。この時間内に runner の
  インストール・起動とドライバ HTTP サーバの listen まで終わる必要が
  ある。Maestro 既定は 15 秒だが、シミュレーター起動直後・高負荷時には
  不足する（高負荷時はドライバ起動だけで 3 分以上かかることを確認済み）
  ため、未設定ならスクリプトが `300000` を設定する（issue #320）

## Clerk のテストモード

Clerk 認証は dev インスタンスのテストモードを使う。毎回ユニークな
`e2e<ts>+clerk_test@example.com` でサインアップする。メール認証が求められた
場合は固定コード `424242` で通すが、test_mode の `+clerk_test` では認証が
自動スキップされ `status=complete` でホーム直行することもあるため、
`subflows/sign-up.yaml` は `verification-code-input` が出た時だけ
`subflows/verify-email.yaml` でコード入力する分岐になっている。
最後にアカウント削除まで行うため Clerk 側にゴミは残らない
（削除失敗時のみ dev ダッシュボードから手動削除する）。

## e2e-ios.sh が行うこと

1. E2E 専用シミュレーター `animeishi-e2e-<ワークツリー名>` を `simctl create` で作成
   （既にあれば再利用。ワークツリー単位で一意なため、同一ホストで並列実行しても
   他作業者のシミュレーターと衝突しない）。
   既定のランタイムは**インストール済みの iOS 18.x のうち最新**（issue #298。
   iOS 26.5 では Maestro のドライバ接続が不安定で、ドライバ起動タイムアウトや
   途中切断で E2E が頻繁に失敗するため）。18.x が無ければ最新のランタイムに
   フォールバックし、その旨を表示する。既存の同名シミュレーターが別ランタイムで
   作られていた場合は作り直す。`E2E_SIM_NAME` を指定したときはこの選択を行わず、
   従来どおり最新のランタイムで作り・既存シミュレーターも再利用する
2. `ios/Animeishi.xcworkspace` が無い、または `ios/` が現在のネイティブ入力
   から生成されたものでない（下記の `ios/.e2e-native-key` と不一致・未記録）
   ときは `expo prebuild -p ios --clean` で作り直し、使った上流キーを
   `ios/.e2e-native-key` に記録する。`ios/` が残っていると prebuild が
   CocoaPods をスキップするため、それでも xcworkspace が無いときは続けて
   `pod install` を実行する（issue #275）
3. `xcodebuild -configuration Release -sdk iphonesimulator` で Release 相当ビルド
   （成果物: `ios/build/e2e-dd/Build/Products/Release-iphonesimulator/Animeishi.app`）
   - 署名は `CODE_SIGN_IDENTITY="-"`（ad-hoc）にする。
     `CODE_SIGNING_ALLOWED=NO` にすると entitlements がバイナリに埋め込まれず
     Keychain（expo-secure-store で Clerk のセッション保存に使用）が
     `SecError -34018` で失敗し、`signUp.create` が `status:null` の
     空リソースを返してサインアップが進まなくなる
   - ビルド済み `.app` はネイティブキャッシュ（後述）に保存され、次回以降は
     worktree をまたいで再利用される
4. シミュレーターへアプリを再インストールして `maestro test .maestro` を実行。
   ドライバ未接続系の失敗（「失敗の調査」参照）のときだけ、ビルドは
   やり直さず `maestro test` だけを最大 `E2E_MAESTRO_ATTEMPTS` 回
   再実行する（issue #320）

## ネイティブキャッシュ（issue #292）

フルビルドは 30 分〜1 時間かかるため、ビルド済みの Release `.app` を
`~/Library/Caches/animeishi-e2e/<上流キー>-<ios フィンガープリント>/Animeishi.app`
に保存し、worktree をまたいで使い回す。

- **上流キー**: ネイティブ成果物に効く入力だけから作る。`package.json`・
  `app.json`/`app.config.*`・`pnpm-lock.yaml`・`pnpm-workspace.yaml`・
  `patches/`（あれば）・`assets/`（アイコン・スプラッシュ等）のハッシュと、
  Xcode / CocoaPods の版を連結してハッシュ化する。
  JS バンドルにだけ効く入力（`index.js`・`app/`・`metro.config.ts`・
  `.env` の `EXPO_PUBLIC_*` など）は入れない（ヒット時に毎回差し替えるため）。
- **ios フィンガープリント**: `ios/`（`Pods/`・`build/`・`xcuserdata/`・
  `.e2e-native-key`・`.e2e-native-fp` を除く）の中身のハッシュ。
  `ios/Podfile` や `Podfile.lock`、Xcode 設定を含む。ファイルごとの
  digest とパスの行一覧をハッシュする。`project.pbxproj` の 24 桁 UUID
  は pod install ごとにランダム生成され意味を持たないため、ハッシュ前に
  定数へ正規化する（正規化しないと同じ入力の `ios/` が prebuild ごとに
  別 leaf になり worktree 間共有が成立しない）。`ios/` は生成物だが、
  ローカルで手直しした場合はフィンガープリントが変わるため別バリアント
  のエントリとして扱われ、手直し前の `.app` に誤ヒットしない。
  `ios/` が無い worktree は、leaf 内の印 `.e2e-clean`（後述）が付いた
  エントリだけを使い、それが 1 つだけのときに限りヒットする。
- **ios/ の鮮度（`ios/.e2e-native-key` / `ios/.e2e-native-fp`）**:
  prebuild に使った上流キーと、生成直後の `ios/` フィンガープリントを
  `ios/` 内に記録する。`ios/` がある worktree はキーの記録が今の
  上流キーと一致しない（または無い）とフィンガープリントで lookup せず、
  `expo prebuild --clean` で作り直してから再評価する。これがないと
  古い入力で生成した `ios/` から作った `.app` が新しい上流キーで
  キャッシュに入り、他 worktree が古いネイティブを拾ってしまう
  （キャッシュ汚染）。`E2E_SKIP_BUILD=1` のときは `ios/build/e2e-dd`
  の成果物を使うため、このチェックとキー計算は行わない。
- **クリーン印（`.e2e-clean`）**: ビルドした `.app` を保存するとき、
  保存元の `ios/` が生成直後のまま（`ios/.e2e-native-fp` の記録と現在の
  フィンガープリントが一致）だった leaf にだけ leaf 内へ印を付ける。
  手直し `ios/` 由来の leaf も、同じフィンガープリントを持つ
  worktree（手直しした本人）なら再利用できるため保存自体は行うが、
  印は付かない。`ios/` が無い worktree は生成される `ios/` の
  フィンガープリントを知らないため、印のある leaf（= 上流キーから
  一意に決まる `ios/` で作られたもの）だけを拾う。これがないと、
  手直し `ios/` で作られた leaf が唯一の leaf だったときに ios/ 無し
  worktree がそれを拾い、手直し入りのネイティブで E2E が通ってしまう。
- **ヒット時**: キャッシュの `.app` を `.e2e-ios/app/` にコピーし、
  Xcode の "Bundle React Native code and images" フェーズと同じ手順
  （`expo export:embed` で平文 JS + アセットを出力 → `hermesc -O` で
  バイトコード化）で `main.jsbundle` とアセットを作り直して差し替え、
  `codesign --force --sign - --preserve-metadata=entitlements` で
  ad-hoc 署名し直して使う。`EXPO_PUBLIC_*` はバンドルに埋め込まれるため
  xcodebuild と同じ値を export に渡す。hermesc は Xcode フェーズと同じ
  `hermes-compiler` npm パッケージのバイナリ（react-native の依存グラフ
  経由で解決。SDK 58 / RN 0.88 では react-native 同梱の
  `sdks/hermesc` は無い）を使うため `ios/` が無い worktree でも動く
  （`export:embed --bytecode` 単発は `-O` が付かないので使わない）。
  `EXUpdates.bundle/app.manifest`（expo-updates の埋め込みアップデートの
  アセット目録）も Xcode のビルドフェーズと同じ
  `expo-updates/utils/build/createUpdatesResources.js` で作り直す。
  作り直さないと JS で追加した画像アセットが目録に載らず、起動した
  アプリで解決されず表示されない。
- **ミス時**: 従来どおり prebuild（必要なら）と xcodebuild を実行し、
  できた `.app` を一時ディレクトリにコピーしてから rename でキャッシュに
  入れる（読み手が書き込み途中を掴まないようアトミックにする）。
  保存・掃除はホストロックの中で行う。
- **掃除**: ヒット・保存のたびにキャッシュディレクトリを touch して LRU にし、
  新しいものから 3 個だけ残す。
- **`E2E_SKIP_BUILD=1`** はキャッシュより優先され、従来どおり
  `ios/build/e2e-dd` の `.app` をそのまま使う（差し替えも署名し直しもしない）。
- **`E2E_NATIVE_CACHE=0`** で読み書き両方をやめて必ずフルビルドする。
  壊れたキャッシュを作り直したいときは `rm -rf ~/Library/Caches/animeishi-e2e`
  してから通常実行する。

## 実行中の状態とロック

実行中の状態は `apps/mobile/.e2e-ios/`（gitignore 済み）に置く（issue #275）:

- `lock/` … mkdir で取るロックディレクトリ（中の `owner` にスクリプトの
  PID と起動時刻）。同じワークツリーでの多重起動は `ios/build/e2e-dd`
  のビルド DB を取り合って失敗するため、所有者が e2e-ios.sh として
  生きている（PID + 起動時刻が一致）ならエラーで止める。
  前回実行が SIGKILL 等で落ちて残った残骸は `reclaim` ロックで回収を
  直列化してから取り除く（複数起動が同時に消し合わないようにするため）
- `api.pid` … スクリプトが起動した wrangler dev の PID と起動時刻。
  スクリプトが SIGKILL で落ちて API が残った場合、次回起動時に
  PID + 起動時刻が一致したプロセス（= 自分が起動したと確認できるもの）
  だけをプロセスグループごと停止してから立て直す。
  PID ファイルで確認できない起動済み API は従来どおり再利用する
  （別用途で立てた `wrangler dev` 等の無関係なプロセスは止めない）

API のポートは全ワークツリー共通なので、別ワークツリーの E2E が同じ
API を再利用しうる。各実行は `${TMPDIR}/animeishi-e2e-api-users/` に
自分の PID + 起動時刻を登録し、終了時に消す。自分が起動した API を
止めるとき（正常終了・残骸回収のどちらでも）、レジストリに生きた
他実行が残っていれば止めずに残す（api.pid も残し、最後に使い終わった
後の実行が回収する）。他実行の登録が残ったまま死んでいる残骸は、
登録の照合時に掃除する。

ビルドと Maestro の実行は PC への負荷が大きいため、ホスト単位で同時に
1 本に限るロックを取る（issue #291）。ロックはユーザー固有の一時領域
（`getconf DARWIN_USER_TEMP_DIR`、通常は `$TMPDIR`）の
`animeishi-e2e-host.lock` に mkdir で取り、`owner` に
PID・起動時刻・ワークツリー名・プロセスグループ ID を書く。
ビルド開始の直前に取得して
Maestro が終わるまで持ち、`E2E_SKIP_BUILD=1` のときも取る。
シミュレーターの検索・作り直し・作成もロックの中で行う（別ワークツリーの
実行が同名シミュレーターを使用中に消されないようにするため。issue #298）。
別ワークツリーが実行中のときはエラーにせず、所有者の
ワークツリー名・PID を表示しながら 30 秒おきに再確認して終了を待つ。
待ち時間の上限は `E2E_HOST_LOCK_TIMEOUT`（秒、既定 3600）で、
超えるとエラーで終える。所有者が SIGKILL 等で落ちた残骸ロックは
ワークツリー内の `lock/` と同じく PID + 起動時刻で判定し、
同じ一時領域の `animeishi-e2e-host.reclaim` で回収を直列化してから
取り除く。回収時には、所有者のプロセスグループの中で親が launchd に
付け替わった孤児（ppid=1）かつコマンドラインがビルド・テスト系
（xcodebuild / maestro / XCTest ドライバ / simctl）のものだけを
停止する。生存中の親シェルや vp・エージェントは ppid=1 ではないので
誤って止めることはなく、API サーバ系（wrangler 等）も対象外。

## 失敗の調査

### Maestro の iOS ドライバ接続が切れる（issue #320）

ログに次のいずれかが出る失敗は、テスト対象アプリではなく Maestro の
ドライバ（XCTest runner）との接続が切れた flake。

- `iOS driver not ready in time` … ドライバの起動待ち
  （`MAESTRO_DRIVER_STARTUP_TIMEOUT`）がタイムアウト。この待ち時間には
  runner 起動用の `xcodebuild test-without-building` の実行も含まれる
  ため、シミュレーターの起動直後やホスト高負荷時に起きる
  （loadavg 180 超の環境ではドライバ起動に約 4 分かかることを確認）。
  Maestro 既定の 15 秒は短いため、スクリプトは未設定時に 300 秒へ
  引き上げている
- `Device became unreachable` / `Device unreachable while processing ...`
  / `Unable to ... : Failed to connect to /127.0.0.1:<port>` … 実行の途中で
  ドライバの HTTP サーバが落ち、以降のフローが全部失敗する。
  status bar の AX 解決がレースすると `testHttpServer` が落ちる上流の
  既知バグ（mobile-dev-inc/Maestro#3538）で、未修正。マシン負荷が高い
  ほど起きやすく、iOS 26.x ではさらに頻発する（issue #298 も参照）。

対処: e2e-ios.sh は試行ごとの maestro のログにこれらのパターンが
あるときだけ `maestro test` を自動でやり直す（最大
`E2E_MAESTRO_ATTEMPTS` 回、既定 3。ビルドはやり直さない）。
やり直し前に、maestro が諦めても孤児として残る driver 起動用の
`xcodebuild test-without-building`（コマンドラインの
`-destination id=<UDID>` で自分のシミュレーター向けのものだけ選ぶ）を
止め、シミュレーターを再起動して `bootstatus -b` で起動完了を待つ。
アサーション失敗・要素が見つからない等のアプリ側の失敗はリトライ
しない（本物の失敗を隠さないため）。リトライの各ログは
`apps/mobile/.e2e-ios/maestro-attempt-<n>.log` に残る。

サインアップ後にドライバが切れた場合、再実行のフローは新しいメールで
別アカウントを作るため、前の試行のテストアカウントが Clerk の dev
インスタンスに残る。そのためスクリプトはドライバ切断を検出した試行の
`~/.maestro/tests/<run>/maestro.log` から使ったメールを拾い、
`apps/api/.dev.vars` の `CLERK_SECRET_KEY`（sk_test のときだけ使う）
で Clerk API の `email_address` 完全一致検索 → `DELETE /users/{id}` を
呼んで自動削除する。鍵が無い・削除に失敗した場合は残ったメールをログに
出すので、dev ダッシュボードから手動削除する（Users で該当メールを
検索して Delete）。

それでもダメなときは、別の `maestro test` 実行中の残骸ドライバや
シミュレーターの不調を疑い、`xcrun simctl shutdown <UDID>` で
シミュレーターを再起動してから `E2E_SKIP_BUILD=1` で試す。
Maestro 側の修正は #3538 の解決待ち（2026-10 時点で 2.12.0 にも
driver 接続の修正は入っていない）。
