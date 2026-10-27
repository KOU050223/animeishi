#!/usr/bin/env bash
# iOS シミュレーターで Maestro E2E を実行する（issue #42）。
#   専用シミュレーター作成 → Release 相当ビルド → インストール → maestro test
#
# 前提:
#   - maestro CLI（brew install mobile-dev-inc/tap/maestro）
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

# --- 専用シミュレーター -------------------------------------------------------
# 既定ではインストール済みの iOS 18.x のうち最新のランタイムを使う
# （iOS 26.5 では Maestro のドライバ接続が不安定で E2E が頻繁に失敗する。
# issue #298）。18.x が無ければ従来どおり最新のランタイムにフォールバックし、
# その旨を表示する。E2E_SIM_NAME を指定したときはこの選択を行わず、
# 従来どおり最新のランタイムで作る。
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
if [ -n "$UDID" ] && [ -n "$RUNTIME_ID" ] && [ "$EXISTING_RUNTIME_ID" != "$RUNTIME_ID" ]; then
  # 既定のランタイムと違うランタイムの同名シミュレーターが残っている
  # （ランタイム変更前に作られたもの等）→ 作り直す
  echo "シミュレーター $SIM_NAME は $EXISTING_RUNTIME_ID で作成済みのため、$RUNTIME_ID で作り直します ..."
  xcrun simctl shutdown "$UDID" 2>/dev/null || true
  xcrun simctl delete "$UDID"
  UDID=""
fi
if [ -z "$UDID" ]; then
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
  # "Incompatible device" で失敗する。issue #298）
  DEVICE_TYPE="$(xcrun simctl list runtimes -j \
    | RUNTIME_ID="$RUNTIME_ID" /usr/bin/python3 -c 'import json,os,sys
want = os.environ["RUNTIME_ID"]
rt = next(r for r in json.load(sys.stdin)["runtimes"] if r["identifier"] == want)
ts = [t["identifier"] for t in rt.get("supportedDeviceTypes", [])
      if t["identifier"].split(".")[-1].startswith("iPhone-1")]
ts.sort()
print(ts[-1])')"
  echo "E2E 用シミュレーターを作成: $SIM_NAME ($DEVICE_TYPE / $RUNTIME_ID)"
  UDID="$(xcrun simctl create "$SIM_NAME" "$DEVICE_TYPE" "$RUNTIME_ID")"
fi
echo "使用シミュレーター: $SIM_NAME ($UDID)"

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
if [ ! -d ios/Animeishi.xcworkspace ]; then
  echo "ios/Animeishi.xcworkspace がないため expo prebuild を実行します ..."
  pnpm expo prebuild -p ios
  # ios/ が残っていると prebuild が CocoaPods をスキップし、xcworkspace が
  # 作られないまま xcodebuild が失敗するため明示的に pod install する（issue #275）
  if [ ! -d ios/Animeishi.xcworkspace ]; then
    echo "xcworkspace がまだないため pod install を実行します ..."
    (cd ios && pod install)
  fi
fi

if [ "$SKIP_BUILD" != "1" ]; then
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
fi

APP_PATH="$DERIVED_DATA/Build/Products/Release-iphonesimulator/Animeishi.app"
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
