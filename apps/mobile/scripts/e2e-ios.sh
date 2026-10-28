#!/usr/bin/env bash
# iOS シミュレーターで Maestro E2E を実行する（issue #42）。
#   専用シミュレーター作成 → Release 相当ビルド → インストール → maestro test
#
# 前提:
#   - maestro CLI 1.39.0 以降（brew install mobile-dev-inc/tap/maestro。
#     subflows の optional: true が必要）
#   - Xcode + iOS シミュレーターランタイム
#   - pnpm install 済み（ios/ が無ければ expo prebuild を実行する）
#   - EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY に pk_test（開発インスタンス）。
#     未設定なら apps/mobile/.env から読む。pk_live は誤爆防止で拒否する。
#   - EXPO_PUBLIC_API_URL（既定: http://localhost:8787）
#
# 他ワーカーと衝突しないよう、E2E 専用シミュレーター（E2E_SIM_NAME、
# 既定 "animeishi-e2e-<ワークツリー名>"）を simctl create で作って使う。
# 同じワークツリーでの多重起動は .e2e-ios/lock で弾く（issue #275）。
# ビルドと Maestro の実行はユーザー固有の一時領域の animeishi-e2e-host.lock で
# PC 全体で同時 1 本に絞り、別ワークツリーの実行中は終わるまで待つ（issue #291）。
set -euo pipefail

cd "$(dirname "$0")/.."

# --- 多重起動の排除（issue #275）--------------------------------------------
# 実行状態（ロック・起動した API の PID）を置く gitignore 済みディレクトリ。
# 同じワークツリーで二重起動すると ios/build/e2e-dd のビルド DB を取り合って
# xcodebuild が "database is locked" で失敗するため、ロックで弾く。
STATE_DIR="$PWD/.e2e-ios"
LOCK_DIR="$STATE_DIR/lock"
LOCK_OWNER_FILE="$LOCK_DIR/owner"
API_PID_FILE="$STATE_DIR/api.pid"
# PC 全体で共有するホストロック（issue #291）。ビルドと Maestro の実行は
# PC に大きな負荷をかけるため、全ワークツリーで共通の場所にロックを取って
# 同時実行を 1 本に絞る。取得はビルド開始の直前（後述）に行い、
# Maestro が終わるまで持つ。E2E_SKIP_BUILD=1 でも Maestro は重いので取る。
# TMPDIR は実行環境で差がありうるので、環境変数に依らないユーザー固有の
# 一時領域（macOS の DARWIN_USER_TEMP_DIR、それ以外は TMPDIR か /tmp）を使う。
HOST_LOCK_BASE="$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null || echo "${TMPDIR:-/tmp}")"
HOST_LOCK_DIR="$HOST_LOCK_BASE/animeishi-e2e-host.lock"
HOST_LOCK_OWNER_FILE="$HOST_LOCK_DIR/owner"
HOST_LOCK_RECLAIM_DIR="$HOST_LOCK_BASE/animeishi-e2e-host.reclaim"
# ホストロックを取得済みかの印。cleanup で自分が持つロックだけを外す。
HOST_LOCK_HELD=""
mkdir -p "$STATE_DIR"

# ps -o lstart= の出力は前後に空白が付くので両端を削って返す。
# PID + 起動時刻の照合で、PID が再利用された無関係プロセスを見分ける。
lstart() {
  ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//; s/ *$//'
}

# プロセスグループ ID を返す。ホストロックの残骸回収で、SIGKILL された
# 実行が残した子プロセス（xcodebuild 等）を止めるのに使う。
pgid() {
  ps -o pgid= -p "$1" 2>/dev/null | tr -d ' '
}

# 指定したプロセスグループの中で、死んだ所有者が起動したと分かる
# 重いプロセスの PID を列挙する。
# 非対話シェル（vp run やエージェントの exec）では e2e-ios.sh は自分の
# グループリーダーにならず親と同じ PGID を引き継ぐため、グループ内には
# 生存中の親シェル・vp・エージェント本体も混ざる。そこで対象を、
#   - 親が launchd (ppid=1) に付け替わった孤児（= 所有者の死後も残ったもの）
#   - コマンドラインがビルド・テスト系に一致するもの
# に限定する。生きている親プロセスは ppid=1 ではないので誤って止めない。
host_lock_orphan_pids() {
  local pid ppid g comm
  ps -eo pid=,ppid=,pgid=,command= | while read -r pid ppid g comm; do
    [ "$g" = "$1" ] && [ "$ppid" = 1 ] || continue
    case "$comm" in
      *xcodebuild* | *maestro* | *UITests-Runner* | *simctl*) ;;
      *) continue ;;
    esac
    echo "$pid"
  done
}

# 残骸ホストロックの所有者（死んだ e2e-ios.sh）が残した孤児プロセスを
# 止める。$1 = 所有者に記録されていた PGID。親が SIGKILL されても
# xcodebuild や Maestro は生き残るので、ロックだけ回収すると孤児ビルドが
# 残り、結局並列ビルドになる。PGID はメンバーが生きている間は再利用
# されないため、孤児になったメンバーは死んだ実行の残りと判断できる。
reap_host_lock_orphans() {
  local lock_pgid="$1" pids
  { [ -n "$lock_pgid" ] && [ "$lock_pgid" != "$(pgid $$)" ]; } || return 0
  pids="$(host_lock_orphan_pids "$lock_pgid")"
  [ -n "$pids" ] || return 0
  echo "終了した e2e:ios の孤児プロセスを停止します: $(echo "$pids" | tr '\n' ' ')"
  printf '%s\n' "$pids" | xargs kill 2>/dev/null || true
  sleep 5
  pids="$(host_lock_orphan_pids "$lock_pgid")"
  [ -z "$pids" ] || printf '%s\n' "$pids" | xargs kill -9 2>/dev/null || true
}

# ロック所有者が実行中の e2e-ios.sh なら真。$1 = owner ファイルのパス。
# 記録した PID と起動時刻が現在のプロセスと一致するときだけ有効とみなし、
# 前回実行が SIGKILL 等で残した残骸は偽（→ 取り直し）と判定する。
lock_owner_alive() {
  local pid started
  { read -r pid && read -r started; } <"$1" 2>/dev/null || return 1
  [ -n "$pid" ] && [ -n "$started" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  ps -o command= -p "$pid" 2>/dev/null | grep -q e2e-ios.sh || return 1
  [ "$(lstart "$pid")" = "$started" ]
}

# 既存ロックの状態を live / acquiring / stale で返す。
# $1 = ロックディレクトリ、$2 = owner ファイルのパス。
# live: 実行中 / acquiring: mkdir 直後で所有者情報の公開前 / stale: 残骸。
# 所有者情報が無いロックは「取得中」か「書き込み前に殺された残骸」なので、
# できてからの経過時間（stat -f %B）で見分ける。
lock_state() {
  if [ -s "$2" ]; then
    lock_owner_alive "$2" && echo live || echo stale
  elif [ $(( $(date +%s) - $(stat -f %B "$1" 2>/dev/null || echo 0) )) -lt 60 ]; then
    echo acquiring
  else
    echo stale
  fi
}

# mkdir で排他的にロックを取る。取れなければ所有者を調べ、死んでいれば
# 残骸として回収して取り直す。回収は reclaim ロックで直列化し、複数の
# 起動が同じ残骸ロックを同時に消し合って二重起動になるのを防ぐ。
while :; do
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    # 所有者情報を一時ファイル経由で一度に公開し、読み手が
    # 「書き込み途中の空ファイル」を残骸と誤認しないようにする
    printf '%s\n%s\n' "$$" "$(lstart $$)" >"$STATE_DIR/owner.$$"
    mv "$STATE_DIR/owner.$$" "$LOCK_OWNER_FILE"
    break
  fi
  case "$(lock_state "$LOCK_DIR" "$LOCK_OWNER_FILE")" in
    live)
      echo "このワークツリーで既に e2e:ios が実行中です (PID $(sed -n '1p' "$LOCK_OWNER_FILE"))。終わるまで待ってから再実行してください" >&2
      exit 1
      ;;
    acquiring)
      echo "このワークツリーで e2e:ios が起動処理中です。少し待ってから再実行してください" >&2
      exit 1
      ;;
  esac
  # stale → 残骸ロックの回収。reclaim も mkdir の排他ロックで、
  # 取れた者だけが lock を消して取り直せる
  if mkdir "$STATE_DIR/reclaim" 2>/dev/null; then
    if [ "$(lock_state "$LOCK_DIR" "$LOCK_OWNER_FILE")" != stale ]; then
      # 回収の隙間に別の実行がロックを取り直していた
      rm -rf "$STATE_DIR/reclaim"
      echo "このワークツリーで e2e:ios が実行中です。終わるまで待ってから再実行してください" >&2
      exit 1
    fi
    rm -rf "$LOCK_DIR" "$STATE_DIR/reclaim"
  elif [ $(( $(date +%s) - $(stat -f %B "$STATE_DIR/reclaim" 2>/dev/null || echo 0) )) -gt 120 ]; then
    rm -rf "$STATE_DIR/reclaim" # 回収処理自体が殺された残骸
  else
    echo "他の e2e:ios がロックの残骸を回収中です。少し待ってから再実行してください" >&2
    exit 1
  fi
done

# --- API 利用の共有レジストリ -------------------------------------------------
# EXPO_PUBLIC_API_URL のポートは全ワークツリー共通なので、起動済みの API を
# 別ワークツリーの E2E が再利用しうる。自分が起動した API を止める前に
# 「他の実行がまだ使っているか」をここで調べ、使用中なら止めない。
# 各実行は自分の PID + 起動時刻を登録し、終了時に削除する。
API_USERS_DIR="${TMPDIR:-/tmp}/animeishi-e2e-api-users"
API_USER_FILE="$API_USERS_DIR/$(printf '%s' "$PWD" | cksum | cut -d' ' -f1)"
mkdir -p "$API_USERS_DIR"
# 登録はホストロック取得後に行う（後述）。待機中の実行を利用者に数えると、
# ロック保持側が「他に使っている実行がいる」と判断して API を残し、
# 待機側は起動者ではないので誰も止めずに孤児化する。

# 自分以外に登録のあるワークツリーが生きているか。所有者が死んだ
# 残骸エントリはここで掃除する。
api_has_other_users() {
  local f pid started
  for f in "$API_USERS_DIR"/*; do
    [ -e "$f" ] || continue
    [ "$f" = "$API_USER_FILE" ] && continue
    { read -r pid && read -r started; } <"$f" 2>/dev/null || continue
    if [ -n "$pid" ] && [ -n "$started" ] && [ "$(lstart "$pid")" = "$started" ]; then
      return 0
    fi
    rm -f "$f"
  done
  return 1
}

# 起動した API（wrangler dev）のサブシェル PID。空なら既存 API を再利用中。
API_PID=""
cleanup() {
  rm -f "$API_USER_FILE"
  if [ -n "$API_PID" ]; then
    if api_has_other_users; then
      # 他ワークツリーの実行がまだこの API を使っている → 止めずに
      # 起動者の記録（api.pid）を残す。使い終わった後に動いた実行が回収する
      :
    else
      kill -- -"$API_PID" 2>/dev/null || kill "$API_PID" 2>/dev/null
      wait "$API_PID" 2>/dev/null || true
      rm -f "$API_PID_FILE"
    fi
  fi
  rm -rf "$LOCK_DIR" "$STATE_DIR/owner.$$"
  if [ -n "$HOST_LOCK_HELD" ]; then
    rm -rf "$HOST_LOCK_DIR"
  fi
}
trap cleanup EXIT

# ワークツリー単位で一意にして、同一ホスト上の並列実行同士が
# 同じシミュレーターを共有しないようにする。
WORKTREE_NAME="$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")"
SIM_NAME="${E2E_SIM_NAME:-animeishi-e2e-$WORKTREE_NAME}"
APP_BUNDLE_ID="com.animeishi.app"
DERIVED_DATA="ios/build/e2e-dd"
SKIP_BUILD="${E2E_SKIP_BUILD:-0}"

# ネイティブビルドの使い回しキャッシュ（issue #292）。
# ビルド済みの Release .app を worktree 間で共有し、ヒット時は JS バンドルだけ
# 差し替えて使う。E2E_NATIVE_CACHE=0 でキャッシュを一切使わずフルビルドする。
NATIVE_CACHE="${E2E_NATIVE_CACHE:-1}"
NATIVE_CACHE_ROOT="$HOME/Library/Caches/animeishi-e2e"
NATIVE_CACHE_KEEP=3

# --- Clerk / API の設定 -----------------------------------------------------
# 環境変数が未設定なら .env（gitignore 済み）を読む。
if [ -z "${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-}" ] && [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

: "${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:?EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY を設定してください（pk_test の開発インスタンス。GitHub Variable EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY_PREVIEW と同じ値）}"
case "$EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY" in
  pk_test_*) ;;
  *)
    echo "E2E は Clerk 開発インスタンス (pk_test) 専用です。pk_live は使えません" >&2
    exit 1
    ;;
esac
EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-http://localhost:8787}"

# --- ホストロック取得（issue #291）--------------------------------------------
# ここから先の API 起動・ビルド・シミュレーター操作・Maestro は PC に大きな
# 負荷をかける（xcodebuild が clang を並列で多数走らせる）ため、ホストロックを
# 取って PC 全体で同時に 1 本に絞る。ワークツリー内の lock とは違い、別
# ワークツリーが実行中のときはエラーにせず、所有者のワークツリー名と PID を
# 表示しながら 30 秒おきに再確認して終了を待つ。待ち時間の上限は
# E2E_HOST_LOCK_TIMEOUT（秒、既定 3600）で、超えたらエラーで終える。
# API 利用者登録より前に取る: 待機中に登録すると、ロック保持側が「API の
# 利用者がいる」と判断して終了時に API を残し、待機側は起動者でないため
# 誰も止めずに wrangler dev が孤児化する。
HOST_LOCK_TIMEOUT="${E2E_HOST_LOCK_TIMEOUT:-3600}"
case "$HOST_LOCK_TIMEOUT" in
  # 非数値と、オーバーフローしうる 10 桁以上の値は既定値に戻す
  '' | *[!0-9]* | ??????????*) HOST_LOCK_TIMEOUT=3600 ;;
  # 先頭ゼロは $(( )) で 8 進数と解釈され 08/09 がエラーになるため 10 進数に正規化
  *) HOST_LOCK_TIMEOUT=$((10#$HOST_LOCK_TIMEOUT)) ;;
esac
host_lock_deadline=$(( $(date +%s) + HOST_LOCK_TIMEOUT ))
while :; do
  if mkdir "$HOST_LOCK_DIR" 2>/dev/null; then
    HOST_LOCK_HELD=1
    # 所有者情報（PID・起動時刻・ワークツリー名・PGID）を一時ファイル経由で
    # 一度に公開する。PGID は残骸回収時に孤児のビルドプロセスを止めるために使う
    printf '%s\n%s\n%s\n%s\n' "$$" "$(lstart $$)" "$WORKTREE_NAME" "$(pgid $$)" >"$HOST_LOCK_DIR/owner.$$"
    mv "$HOST_LOCK_DIR/owner.$$" "$HOST_LOCK_OWNER_FILE"
    echo "ホストロックを取得しました (PID $$)。ビルドと Maestro を開始します"
    break
  fi
  if [ "$(lock_state "$HOST_LOCK_DIR" "$HOST_LOCK_OWNER_FILE")" = stale ]; then
    # 所有者が死んだ残骸 → ワークツリー内の lock と同じく reclaim ロックで
    # 回収を直列化してから取り除き、取り直す
    if mkdir "$HOST_LOCK_RECLAIM_DIR" 2>/dev/null; then
      # ps の一時的な失敗で live の所有者を stale と誤認して消さないよう、
      # 間を置いてから再確認する
      sleep 1
      if [ "$(lock_state "$HOST_LOCK_DIR" "$HOST_LOCK_OWNER_FILE")" = stale ]; then
        host_lock_stale_pgid="$(sed -n '4p' "$HOST_LOCK_OWNER_FILE" 2>/dev/null || true)"
        echo "終了した e2e:ios の残骸ホストロックを回収します"
        rm -rf "$HOST_LOCK_DIR"
        reap_host_lock_orphans "$host_lock_stale_pgid"
      fi
      rm -rf "$HOST_LOCK_RECLAIM_DIR"
      continue
    elif [ $(( $(date +%s) - $(stat -f %B "$HOST_LOCK_RECLAIM_DIR" 2>/dev/null || echo 0) )) -gt 120 ]; then
      rm -rf "$HOST_LOCK_RECLAIM_DIR" # 回収処理自体が殺された残骸
      continue
    fi
    # 別の実行が残骸を回収中 → 下の待機に回る
  fi
  host_lock_now="$(date +%s)"
  if [ "$host_lock_now" -ge "$host_lock_deadline" ]; then
    echo "e2e:ios のホストロックが ${HOST_LOCK_TIMEOUT} 秒（E2E_HOST_LOCK_TIMEOUT）待っても取れませんでした。実行中の e2e:ios を確認してください" >&2
    exit 1
  fi
  host_lock_owner_pid="$(sed -n '1p' "$HOST_LOCK_OWNER_FILE" 2>/dev/null || true)"
  host_lock_owner_worktree="$(sed -n '3p' "$HOST_LOCK_OWNER_FILE" 2>/dev/null || true)"
  if [ -n "$host_lock_owner_pid" ]; then
    echo "別ワークツリーの e2e:ios (${host_lock_owner_worktree:-不明}, PID $host_lock_owner_pid) が終わるのを待っています ..."
  else
    echo "別ワークツリーの e2e:ios が起動処理中です。ホストロックを待っています ..."
  fi
  # 上限を超えて眠らないよう、残り秒数と 30 の小さい方だけ待つ
  host_lock_sleep=$(( host_lock_deadline - host_lock_now ))
  [ "$host_lock_sleep" -gt 30 ] && host_lock_sleep=30
  sleep "$host_lock_sleep"
done

# ホストロックを取れたので API の利用者として登録する（待機中は登録しない。
# 理由は上のコメント参照）
printf '%s\n%s\n' "$$" "$(lstart $$)" >"$API_USER_FILE"

# --- 専用シミュレーター -------------------------------------------------------
# 既定ではインストール済みの iOS 18.x のうち最新のランタイムを使う
# （iOS 26.5 では Maestro のドライバ接続が不安定で E2E が頻繁に失敗する。
# issue #298）。18.x が無ければ従来どおり最新のランタイムにフォールバックし、
# その旨を表示する。E2E_SIM_NAME を指定したときはこの選択を行わず、
# 従来どおり最新のランタイムで作る。
# 検索・作り直し・作成はホストロックの中で行う。ロックより前に消すと、
# 別ワークツリーの実行が同名シミュレーターを使用中に消されるため（issue #298）。
RUNTIME_ID=""
if [ -z "${E2E_SIM_NAME:-}" ]; then
  RUNTIME_ID="$(xcrun simctl list runtimes -j \
    | /usr/bin/python3 -c 'import json,sys
rs = [r for r in json.load(sys.stdin)["runtimes"] if r.get("platform") == "iOS" and r.get("isAvailable", True)]
rs.sort(key=lambda r: [int(x) for x in r["version"].split(".")], reverse=True)
r18 = [r for r in rs if r["version"].split(".")[0] == "18"]
picked = r18[0] if r18 else rs[0]
print(picked["identifier"])
if not r18:
    print("iOS 18.x のランタイムが見つかりません。最新の iOS %s を使います" % picked["version"], file=sys.stderr)')"
fi

# 同名のシミュレーターがあればその UDID とランタイムの identifier を返す
EXISTING_SIM="$(xcrun simctl list devices -j \
  | SIM_NAME="$SIM_NAME" /usr/bin/python3 -c 'import json,os,sys
name = os.environ["SIM_NAME"]
for rt, devs in json.load(sys.stdin)["devices"].items():
    for dev in devs:
        if dev["name"] == name and dev.get("isAvailable", True):
            print(dev["udid"])
            print(rt)
            sys.exit()')"
UDID="$(printf '%s\n' "$EXISTING_SIM" | sed -n '1p')"
EXISTING_RUNTIME_ID="$(printf '%s\n' "$EXISTING_SIM" | sed -n '2p')"
RECREATE=0
if [ -z "$UDID" ]; then
  RECREATE=1
elif [ -n "$RUNTIME_ID" ] && [ "$EXISTING_RUNTIME_ID" != "$RUNTIME_ID" ]; then
  # 既定のランタイムと違うランタイムの同名シミュレーターが残っている
  # （ランタイム変更前に作られたもの等）→ 作り直す
  RECREATE=1
  echo "シミュレーター $SIM_NAME は $EXISTING_RUNTIME_ID で作成済みのため、$RUNTIME_ID で作り直します ..."
fi
if [ "$RECREATE" = 1 ]; then
  if [ -z "$RUNTIME_ID" ]; then
    # E2E_SIM_NAME 指定時: 従来どおり最新のランタイムを使う
    RUNTIME_ID="$(xcrun simctl list runtimes -j \
      | /usr/bin/python3 -c 'import json,sys
rs = [r for r in json.load(sys.stdin)["runtimes"] if r.get("platform") == "iOS" and r.get("isAvailable", True)]
rs.sort(key=lambda r: [int(x) for x in r["version"].split(".")], reverse=True)
print(rs[0]["identifier"])')"
  fi
  # デバイスタイプはランタイムの supportedDeviceTypes から選ぶ
  # （最新機種は新しい iOS でしか動かない。iPhone-17e は iOS 18.x では
  # "Incompatible device" で失敗する。issue #298）。
  # 既存シミュレーターを消す前に機種を確定させ、候補が無ければ止める
  DEVICE_TYPE="$(xcrun simctl list runtimes -j \
    | RUNTIME_ID="$RUNTIME_ID" /usr/bin/python3 -c 'import json,os,sys
want = os.environ["RUNTIME_ID"]
rt = next(r for r in json.load(sys.stdin)["runtimes"] if r["identifier"] == want)
ts = [t["identifier"] for t in rt.get("supportedDeviceTypes", [])
      if t["identifier"].split(".")[-1].startswith("iPhone-1")]
ts.sort()
print(ts[-1] if ts else "")')"
  if [ -z "$DEVICE_TYPE" ]; then
    echo "ランタイム $RUNTIME_ID が対応する iPhone のデバイスタイプが見つかりません" >&2
    exit 1
  fi
  if [ -n "$UDID" ]; then
    xcrun simctl shutdown "$UDID" 2>/dev/null || true
    xcrun simctl delete "$UDID"
  fi
  echo "E2E 用シミュレーターを作成: $SIM_NAME ($DEVICE_TYPE / $RUNTIME_ID)"
  UDID="$(xcrun simctl create "$SIM_NAME" "$DEVICE_TYPE" "$RUNTIME_ID")"
fi
echo "使用シミュレーター: $SIM_NAME ($UDID)"

# --- API (wrangler dev) ------------------------------------------------------
# アカウント削除は DELETE /me を呼ぶためローカル API が必須。
# 起動済みならそれを使い、無ければ起動して終了時に落とす。
# /health の "status":"ok" を確認して、同ポートを占有する別サービスを
# API と誤認しないようにする。
api_up() {
  curl -fsS "${EXPO_PUBLIC_API_URL}/health" 2>/dev/null | grep -q '"status":"ok"'
}
# API_PID_FILE に記録した API がまだ生きているか。スクリプトが SIGKILL で
# 落ちると EXIT trap が動かず wrangler dev が残るため、次回起動時に
# ここで回収する。PID の再利用で無関係なプロセスを止めないよう、
# 起動時刻 (lstart) が記録と一致したときだけ「自分が起動した」と判定する。
api_pid_running() {
  [ -f "$API_PID_FILE" ] || return 1
  local pid started
  { read -r pid && read -r started; } <"$API_PID_FILE" 2>/dev/null || return 1
  [ -n "$pid" ] && [ -n "$started" ] || return 1
  [ "$(lstart "$pid")" = "$started" ]
}
if api_pid_running; then
  if api_up && api_has_other_users; then
    # 起動側が SIGKILL で落ちて残った API を別ワークツリーが再利用中。
    # 止めると向こうの実行が壊れるので、このまま使い、起動者の記録
    # （api.pid）は残しておく。使い終わった後に動いた実行が回収する。
    echo "前回起動した API を他ワークツリーの E2E が使用中のため、止めずに再利用します"
  else
    OLD_API_PID="$(sed -n '1p' "$API_PID_FILE")"
    echo "前回起動した API (PID $OLD_API_PID) が残っているため停止します ..."
    kill -- -"$OLD_API_PID" 2>/dev/null || kill "$OLD_API_PID" 2>/dev/null
    for _ in $(seq 1 10); do
      kill -0 "$OLD_API_PID" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$OLD_API_PID" 2>/dev/null; then
      # 消せなかった API を api.pid も消して見失わないよう、記録を残して終了
      echo "残骸 API (PID $OLD_API_PID) が停止しません。手動で止めてから再実行してください" >&2
      exit 1
    fi
    rm -f "$API_PID_FILE"
  fi
fi
# 指定 URL のポートを wrangler dev に引き継ぐ（既定 8787 以外も可）。
API_PORT=""
case "$EXPO_PUBLIC_API_URL" in
  http://*:* | https://*:*)
    API_PORT="${EXPO_PUBLIC_API_URL##*:}"
    API_PORT="${API_PORT%%/*}"
    ;;
esac
if api_up; then
  echo "API は起動済み ($EXPO_PUBLIC_API_URL)"
else
  echo "API を起動します (wrangler dev) ..."
  API_LOG="$(mktemp -t animeishi-e2e-api.XXXXXX)"
  # バックグラウンドジョブに独自プロセスグループを与え、pnpm → wrangler →
  # workerd の子プロセスごと終了できるようにする。
  set -m
  DEV_ARGS=()
  [ -n "$API_PORT" ] && DEV_ARGS+=(--port "$API_PORT")
  (cd ../../apps/api && pnpm dev ${DEV_ARGS[@]+"${DEV_ARGS[@]}"} >"$API_LOG" 2>&1) &
  API_PID=$!
  set +m
  # SIGKILL 等でこのスクリプトが落ちても次回起動時に回収できるよう、
  # PID と起動時刻を記録しておく。
  printf '%s\n%s\n' "$API_PID" "$(lstart "$API_PID")" >"$API_PID_FILE"
  for _ in $(seq 1 60); do
    api_up && break
    sleep 1
  done
  api_up || { echo "API の起動に失敗しました。$API_LOG を確認してください" >&2; exit 1; }
  # ローカル D1 にマイグレーションを適用（適用済みならスキップされる）
  (cd ../../apps/api && pnpm db:migrate:local >/dev/null)
fi

# --- ネイティブプロジェクト / ビルド -----------------------------------------
# prebuild したときの上流キーを ios/.e2e-native-key に記録し、今のキーと
# 違う（または記録が無い）ios/ は expo prebuild --clean で作り直す。
# これがないと、古い入力で生成した ios/ が残った worktree でのフルビルドが
# 「新しい上流キー・古い中身」の .app をキャッシュに入れ、ios/ の無い別
# worktree がそれを拾って古いネイティブのまま E2E が通ってしまう（issue #292）。
# ios/ は CNG の生成物で gitignore 済みなので消してよい。記録の無い ios/
# （スクリプト外の expo prebuild や expo run:ios で作ったもの）も上流入力との
# 対応が保証できないため同じく作り直す。prebuild 後に ios/ を手直しした
# 分離はフィンガープリント（native_ios_fingerprint）側が担う。
ensure_native_project() {
  local recorded=""
  [ -f ios/.e2e-native-key ] && recorded="$(cat ios/.e2e-native-key)"
  if [ -d ios/Animeishi.xcworkspace ]; then
    # NATIVE_KEY が空（E2E_SKIP_BUILD=1）のときは従来どおり存在確認だけにする。
    # スキップ時は ios/build/e2e-dd の成果物をそのまま使うため ios/ を消せない
    if [ -z "$NATIVE_KEY" ] || [ "$recorded" = "$NATIVE_KEY" ]; then
      return 0
    fi
    echo "ios/ が現在のネイティブ入力から生成されたものではないため、expo prebuild --clean で作り直します ..."
  else
    echo "ios/Animeishi.xcworkspace がないため expo prebuild を実行します ..."
  fi
  pnpm expo prebuild -p ios --clean
  # ios/ が残っていると prebuild が CocoaPods をスキップし、xcworkspace が
  # 作られないまま xcodebuild が失敗するため明示的に pod install する（issue #275）
  if [ ! -d ios/Animeishi.xcworkspace ]; then
    echo "xcworkspace がまだないため pod install を実行します ..."
    (cd ios && pod install)
  fi
  if [ -n "$NATIVE_KEY" ]; then
    printf '%s\n' "$NATIVE_KEY" >ios/.e2e-native-key
  fi
}

# ネイティブ成果物（.app）に効く入力からキャッシュキーを作る（issue #292）。
# 誤ヒットの方が害が大きい（古いネイティブのまま E2E が静かに通る）ので、
# ネイティブに効きうるものは広めに拾う。逆に JS バンドルにだけ効く入力
# （index.js・app/・metro.config.ts・.env の EXPO_PUBLIC_* など）は、
# ヒット時に毎回 export:embed で差し替えるのでキーに入れない。
# ios/Podfile.lock のような prebuild 生成物はここには入れず、別途
# native_ios_fingerprint でキャッシュエントリの leaf 名に反映する
# （ios/ がある worktree と無い worktree で同じキーを引けるようにしつつ、
# 手直しされた ios/ は別バリアントとして扱うため。後述）。
native_cache_key() {
  local files=(
    ../../package.json
    ../../pnpm-lock.yaml
    ../../pnpm-workspace.yaml
    package.json
    app.json
  )
  local f
  # app.config.* と pnpm パッチは存在するときだけ拾う
  for f in app.config.*; do [ -e "$f" ] && files+=("$f"); done
  if [ -d ../../patches ]; then
    while IFS= read -r f; do files+=("$f"); done \
      < <(find ../../patches -type f | LC_ALL=C sort)
  fi
  # assets/ はアイコン・スプラッシュ等ネイティブに埋め込まれる画像を含む
  while IFS= read -r f; do files+=("$f"); done \
    < <(find assets -type f | LC_ALL=C sort)
  {
    shasum -a 256 "${files[@]}"
    xcodebuild -version
    pod --version 2>/dev/null || true
  } | shasum -a 256 | cut -d' ' -f1
}

# ios/ が存在するときだけ、その中身のフィンガープリントを返す（無ければ空）。
# ios/ は prebuild + pod install の生成物で、中身は上流入力から一意に決まる
# ため、同じ入力なら worktree 間で同じ値になる。ローカルで ios/ を手直しした
# worktree では別の値になり、手直しが E2E に反映されない誤ヒットを防げる。
# Pods/ と build/ は除外する（Pods のサポートファイルは worktree の絶対
# パスを含み一致しない。Pods の実体は Podfile.lock で代表させる）。
# .e2e-native-key はこのスクリプトの管理ファイルで ios/ の中身ではないため除外。
# pbxproj 内の 24 桁 UUID（Pods の xcconfig 参照等）は pod install ごとに
# ランダム生成され意味を持たないので、ハッシュ前に定数へ正規化する。
# 正規化しないと prebuild のたびにフィンガープリントが変わり、同じ入力の
# ios/ が別 leaf になり worktree 間共有が成立しない。
native_ios_fingerprint() {
  [ -d ios ] || return 0
  find ios -type f ! -path '*/Pods/*' ! -path '*/build/*' ! -path '*/xcuserdata/*' \
    ! -name '.e2e-native-key' \
    | LC_ALL=C sort \
    | while IFS= read -r f; do
        case "$f" in
          *.pbxproj) sed -E 's/[0-9A-F]{24}/000000000000000000000000/g' "$f" ;;
          *) cat "$f" ;;
        esac
        echo "$f"
      done \
    | shasum -a 256 | cut -d' ' -f1
}

# 使えるキャッシュエントリの leaf 名（<key>-<ios_fingerprint>）を返す。
# ios/ がある worktree は自分の ios/ と同じフィンガープリントのエントリだけを
# 使う（かつ ios/.e2e-native-key が今の上流キーと一致するときに限る）。
# ios/ が無い worktree は、生成される ios/ が上流入力から一意に決まる
# はずなので leaf が 1 つだけのときに限り使う（複数バリアントがあると
# 生成結果がどれと一致するか分からず誤ヒットしうるためミス扱いにする）。
native_cache_lookup() {
  local fp
  if [ -d ios ]; then
    # ios/ が現在の上流キーから生成されたものでないと、そのフィンガープリントは
    # 古い ios/ 由来の leaf 名になる。記録が無い・違う ios/ のときは leaf が
    # 存在しても使わず（修正前に汚染保存されたエントリに誤ヒットするのを防ぐ）、
    # ensure_native_project の作り直し後に再評価する
    [ -n "$NATIVE_KEY" ] || return 0
    [ -f ios/.e2e-native-key ] || return 0
    [ "$(cat ios/.e2e-native-key)" = "$NATIVE_KEY" ] || return 0
    fp="$(native_ios_fingerprint)"
    if [ -d "$NATIVE_CACHE_ROOT/$NATIVE_KEY-$fp/Animeishi.app" ]; then
      echo "$NATIVE_KEY-$fp"
    fi
  else
    local matches=("$NATIVE_CACHE_ROOT/$NATIVE_KEY"-*/Animeishi.app)
    if [ -e "${matches[0]}" ] && [ "${#matches[@]}" -eq 1 ]; then
      basename "$(dirname "${matches[0]}")"
    fi
  fi
}

# ビルド済み .app をキャッシュに保存する。一時ディレクトリにコピーしてから
# rename し、読み手が書き込み途中の .app を掴まないようにする
# （ホストロックの中で呼ぶので、実行自体の競合は起きない）。
save_to_native_cache() {
  local tmp
  rm -rf "$NATIVE_CACHE_ROOT"/.tmp.*
  tmp="$(mktemp -d "$NATIVE_CACHE_ROOT/.tmp.XXXXXX")"
  cp -R "$1" "$tmp/Animeishi.app"
  # 同名キーが既にあれば消す。残っていると mv がディレクトリの中に入れてしまい
  # <key>/Animeishi.app に置かれない
  rm -rf "$NATIVE_CACHE_ROOT/${2:?}"
  mv "$tmp" "$NATIVE_CACHE_ROOT/$2"
}

# 古いキャッシュを消す。ヒット・保存のたびに touch して LRU にし、
# 新しいものから NATIVE_CACHE_KEEP 個だけ残す。
prune_native_cache() {
  [ -d "$NATIVE_CACHE_ROOT" ] || return 0
  find "$NATIVE_CACHE_ROOT" -mindepth 1 -maxdepth 1 -type d ! -name '.*' \
      -exec stat -f '%m %N' {} + \
    | sort -rn \
    | tail -n +$((NATIVE_CACHE_KEEP + 1)) \
    | cut -d' ' -f2- \
    | while IFS= read -r d; do rm -rf "$d"; done
}

# .app の JS バンドルを作り直して差し替え、entitlements を保ったまま
# ad-hoc 署名し直す。Xcode の "Bundle React Native code and images" フェーズと
# 同じく export:embed で平文 JS を作ってから hermesc -O でバイトコード化する
# （export:embed --bytecode 単発だと -O が付かない）。EXPO_PUBLIC_* はバンドルに
# 埋め込まれるため xcodebuild と同じ値を渡す。
rebundle_app() {
  local app="$1" hermesc
  # 失敗時に残っても gitignore 済みの STATE_DIR 内に留まるよう、
  # 共有の一時領域ではなく STATE_DIR 配下を使う（次回実行時に消える）
  local tmp="$STATE_DIR/rebundle-tmp"
  rm -rf "$tmp" && mkdir -p "$tmp"
  # 消えたアセットが残らないよう、既存のアセットを消してから書き出す
  rm -rf "$app/assets"
  # --entry-file は Metro の serverRoot（モノレポのワークスペースルート）基準で
  # 解決されるため、Xcode 側と同じく絶対パスで渡す
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="$EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY" \
  EXPO_PUBLIC_API_URL="$EXPO_PUBLIC_API_URL" \
    pnpm expo export:embed \
      --entry-file "$PWD/index.js" \
      --platform ios \
      --dev false \
      --minify false \
      --reset-cache \
      --bundle-output "$tmp/main.jsbundle" \
      --assets-dest "$app"
  # hermesc は Pods ではなく node_modules 同梱のものを使い、ios/ が無い
  # worktree でも動くようにする
  hermesc="$(cd ../../node_modules/react-native/sdks/hermesc/osx-bin && pwd)/hermesc"
  "$hermesc" -emit-binary -max-diagnostic-width=80 -O \
    -out "$app/main.jsbundle" "$tmp/main.jsbundle"
  rm -rf "$tmp"
  # EXUpdates.bundle/app.manifest は expo-updates が起動時に埋め込み
  # アップデートのアセットを解決するための目録。放っておくと古いアセット
  # 一覧のまま残り、JS で追加した画像が起動したアプリに表示されないため、
  # Xcode の expo-updates ビルドフェーズ（create-updates-resources-ios.sh）
  # と同じ createUpdatesResources.js で作り直す。launch asset は目録に無く
  # 固定名の main.jsbundle を指すため、差し替え済みのものがそのまま使われる
  if [ -d "$app/EXUpdates.bundle" ]; then
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="$EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY" \
    EXPO_PUBLIC_API_URL="$EXPO_PUBLIC_API_URL" \
      node ../../node_modules/expo-updates/utils/build/createUpdatesResources.js \
        ios "$PWD" "$app/EXUpdates.bundle" all "$PWD/index.js"
  fi
  # --preserve-metadata=entitlements で Keychain 等の entitlements を保つ
  # （落とすと SecError -34018 で expo-secure-store 経由のサインアップが失敗する）
  codesign --force --sign - --preserve-metadata=entitlements "$app"
}

APP_PATH="$DERIVED_DATA/Build/Products/Release-iphonesimulator/Animeishi.app"
NATIVE_KEY=""
CACHE_LEAF=""
if [ "$SKIP_BUILD" != "1" ]; then
  # キャッシュ無効（E2E_NATIVE_CACHE=0）でも、ビルドに使う ios/ の鮮度判定と
  # ios/.e2e-native-key の記録に使うためキーは常に計算する
  NATIVE_KEY="$(native_cache_key)"
  [ "$NATIVE_CACHE" != "0" ] && CACHE_LEAF="$(native_cache_lookup)"
fi

if [ -z "$CACHE_LEAF" ]; then
  ensure_native_project
  if [ "$NATIVE_CACHE" != "0" ] && [ -n "$NATIVE_KEY" ]; then
    # ios/ が今回生成・作り直しされた worktree でも、生成後なら
    # フィンガープリントで確実に leaf を引けるため再評価する（leaf が
    # 複数あって引けなかった場合も、生成結果と一致する leaf があれば
    # ここで拾える）
    CACHE_LEAF="$(native_cache_lookup)"
  fi
fi

if [ -n "$CACHE_LEAF" ]; then
  echo "ネイティブキャッシュにヒット (key: ${CACHE_LEAF:0:20}...)。JS バンドルを差し替えます"
  rm -rf "$STATE_DIR/app"
  mkdir -p "$STATE_DIR/app"
  cp -R "$NATIVE_CACHE_ROOT/$CACHE_LEAF/Animeishi.app" "$STATE_DIR/app/Animeishi.app"
  rebundle_app "$STATE_DIR/app/Animeishi.app"
  touch "$NATIVE_CACHE_ROOT/$CACHE_LEAF"
  APP_PATH="$STATE_DIR/app/Animeishi.app"
elif [ "$SKIP_BUILD" != "1" ]; then
  echo "Release 相当ビルド中 (iphonesimulator) ..."
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="$EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY" \
    EXPO_PUBLIC_API_URL="$EXPO_PUBLIC_API_URL" \
    SENTRY_DISABLE_AUTO_UPLOAD=true \
    xcodebuild \
      -workspace ios/Animeishi.xcworkspace \
      -scheme Animeishi \
      -configuration Release \
      -sdk iphonesimulator \
      -destination "id=$UDID" \
      -derivedDataPath "$DERIVED_DATA" \
      CODE_SIGN_IDENTITY="-" \
      ONLY_ACTIVE_ARCH=YES
  if [ "$NATIVE_CACHE" != "0" ] && [ -n "$NATIVE_KEY" ]; then
    leaf="$NATIVE_KEY-$(native_ios_fingerprint)"
    echo "ビルド済み .app をネイティブキャッシュに保存します (key: ${leaf:0:20}...)"
    mkdir -p "$NATIVE_CACHE_ROOT"
    save_to_native_cache "$APP_PATH" "$leaf"
    prune_native_cache
  fi
fi

[ -d "$APP_PATH" ] || { echo "アプリが見つかりません: $APP_PATH" >&2; exit 1; }

# --- インストール ------------------------------------------------------------
xcrun simctl boot "$UDID" 2>/dev/null || true
open -a Simulator --args -CurrentDeviceUDID "$UDID" 2>/dev/null || true
# 認証状態を確実にリセットするため再インストールする
xcrun simctl uninstall "$UDID" "$APP_BUNDLE_ID" 2>/dev/null || true
xcrun simctl install "$UDID" "$APP_PATH"

# --- Maestro -----------------------------------------------------------------
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
maestro test --device "$UDID" .maestro
