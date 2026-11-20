// dアニメストア マイページからの履歴抽出スクリプト。
//
// このファイルの文字列リテラルが「実行する JS 本体」。2 つの経路で共用する:
//   - ネイティブ: react-native-webview の injectJavaScript で animestore ドメイン上に注入。
//     結果は window.ReactNativeWebView.postMessage でアプリへ返る。
//   - Web: ブックマークレット（javascript: URL）としてブラウザ上で実行。
//     ReactNativeWebView が無いため、抽出後に Animeishi の受信タブを window.open で
//     開き、postMessage で結果を転送する（貼り付け不要）。転送に失敗した場合のみ
//     クリップボードへフォールバックする。
// どちらも「ユーザーのログイン済みセッション Cookie で same-origin fetch できる」
// ブラウザコンテキストを前提とし、認証情報は一切アプリ側に来ない。
//
// ページ構造の前提（d-tweaks 実測ベース）:
//   - mpa_hst_pc（履歴）/ mpa_cmp_pc（コンプリート）はサーバーサイドページング。
//     form[name=pageForm] の input を丸ごとクエリにして selectPage=N で GET すると
//     N ページ目の完全な HTML が返る。
//   - 総ページ数は .paging .onlySpLayout の "1 / N" 表記から読む。
//   - 作品カードは .itemWrapper > .itemModule（SP 用の .onlySpLayout 複製あり）。
//     workId は input.workId またはリンクの workId= クエリ、話数は partId= クエリ。
//
// サイト側の構造変更で抽出が壊れ得るため、想定要素が見つからない場合は
// 明示的にエラーを投げて呼び出し側で通知できるようにする。
import { DANIME_EXTRACT_SCHEMA_VERSION } from "./types";

export const DANIME_HISTORY_URL =
  "https://animestore.docomo.ne.jp/animestore/mpa_hst_pc?workType=0";

// 抽出メッセージの type 値（アプリ側の onMessage で識別する）。
export const DANIME_EXTRACT_OK = "animeishi:danime-extract";
export const DANIME_EXTRACT_ERR = "animeishi:danime-extract-error";

// ブックマークレット → Animeishi 受信タブ間の postMessage 用 type 値。
export const DANIME_POSTBACK_DATA = "animeishi:danime-data";
export const DANIME_POSTBACK_ACK = "animeishi:danime-ack";

// Animeishi 受信ページが payload を受け取る postMessage 送信元オリジン。
export const DANIME_ORIGIN = "https://animestore.docomo.ne.jp";

/**
 * 実行本体（async IIFE の文字列）。テストでもこの文字列を eval して実行するため、
 * モジュール import やモダン構文（optional chaining 等）は使わず ES2017 程度に留める。
 *
 * @param appOrigin ブックマークレット経路で結果を postMessage する Animeishi 側
 *   オリジン（例: location.origin）。ネイティブ注入用は空文字（転送を無効化）。
 */
export function danimeExtractScript(appOrigin: string): string {
  return String.raw`
(async function () {
  var BASE = "https://animestore.docomo.ne.jp/animestore/";
  var MSG_OK = "${DANIME_EXTRACT_OK}";
  var MSG_ERR = "${DANIME_EXTRACT_ERR}";
  var MSG_DATA = "${DANIME_POSTBACK_DATA}";
  var MSG_ACK = "${DANIME_POSTBACK_ACK}";
  var SCHEMA_VERSION = ${DANIME_EXTRACT_SCHEMA_VERSION};
  var APP_ORIGIN = ${JSON.stringify(appOrigin)};

  // ブックマークレット経路では、抽出結果を受け取る Animeishi のタブを
  // ユーザーのクリックコンテキストのうちに同期で開く（非同期処理の後に
  // window.open するとポップアップブロックされるため）。
  var appWin = null;
  if (!window.ReactNativeWebView && APP_ORIGIN) {
    try {
      appWin = window.open(APP_ORIGIN + "/danime-import?recv=1", "_blank");
    } catch (e) {
      appWin = null;
    }
  }

  function errorHint(code) {
    var hints = {
      wrong_page:
        "dアニメストアのページ（animestore.docomo.ne.jp）を開いた状態で実行してください。",
      not_logged_in: "dアニメストアにログインしてから実行してください。",
      empty_result:
        "履歴データが取得できませんでした。履歴が空か、ページ構造が変更された可能性があります。",
      network_error:
        "通信に失敗しました。ネットワーク接続を確認してから実行してください。",
    };
    return "dアニメ履歴の取得に失敗しました。\n" + (hints[code] || code);
  }

  function copyToClipboard(text) {
    var copying =
      navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(text)
        : Promise.reject(new Error("clipboard unavailable"));
    copying.then(
      function () {
        alert("抽出結果をクリップボードにコピーしました。アプリの貼り付け欄に貼ってください。");
      },
      function () {
        window.prompt("以下をコピーしてアプリの貼り付け欄に貼ってください", text);
      },
    );
  }

  // 抽出結果を開いた Animeishi タブへ postMessage で転送する。
  // 受信側のロード完了を待てないため ack が来るまで 500ms 間隔で再送し、
  // 15 秒で諦めてクリップボードにフォールバックする。
  function deliverToApp(payload) {
    var acked = false;
    var send = function () {
      try {
        appWin.postMessage({ type: MSG_DATA, payload: payload }, APP_ORIGIN);
      } catch (e) {}
    };
    send();
    var timer = setInterval(send, 500);
    // 受信側が重複メッセージに ack を返し得るため、ack 後はリスナーを
    // 解除しないと alert が複数回出る。
    window.addEventListener("message", function onAck(e) {
      if (e.source !== appWin || e.origin !== APP_ORIGIN) return;
      if (!e.data || e.data.type !== MSG_ACK) return;
      acked = true;
      clearInterval(timer);
      window.removeEventListener("message", onAck);
      alert(
        "抽出結果を Animeishi に転送しました。開いたタブでレビューを続けてください。",
      );
    });
    setTimeout(function () {
      if (acked) return;
      clearInterval(timer);
      copyToClipboard(JSON.stringify(payload));
    }, 15000);
  }

  function report(obj) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(obj));
      return;
    }
    // ブックマークレット経路: postMessage の相手がいないので転送/クリップボードへ。
    if (obj.type === MSG_ERR) {
      // 抽出に失敗した場合、受信待ちのまま残る受信タブは閉じる。
      if (appWin) {
        try {
          appWin.close();
        } catch (e) {}
      }
      alert(errorHint(obj.message));
      return;
    }
    if (appWin && APP_ORIGIN) {
      deliverToApp(obj.payload);
      return;
    }
    copyToClipboard(JSON.stringify(obj.payload));
  }

  function parseDoc(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }

  async function fetchDoc(url) {
    var res;
    try {
      res = await fetch(url, { credentials: "same-origin" });
    } catch (e) {
      // fetch の reject（オフライン等）は TypeError。生の "Failed to fetch"
      // は原因が分かりにくいのでコード化する。
      throw new Error("network_error");
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    // 未ログイン時は /animestore/auth → id.smt.docomo.ne.jp へリダイレクトされる。
    if (
      res.url.indexOf("/animestore/auth") !== -1 ||
      res.url.indexOf("id.smt.docomo.ne.jp") !== -1
    ) {
      throw new Error("not_logged_in");
    }
    return parseDoc(await res.text());
  }

  // ".paging .onlySpLayout" の "1 / 30" 表記から総ページ数を読む。
  function totalPages(doc) {
    var el = doc.querySelector(".paging .onlySpLayout");
    if (!el || !el.textContent) return 1;
    var nums = el.textContent
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map(function (n) { return parseInt(n, 10); });
    return nums.length >= 2 ? nums[nums.length - 1] : 1;
  }

  // href は属性値からクエリを正規表現で抜く。new URL は相対 URL のベース解決で
  // 環境差が出るため使わない。
  function hrefParams(module, key) {
    var out = [];
    var re = new RegExp("[?&]" + key + "=([^&#]*)");
    var links = module.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute("href") || "";
      var m = href.match(re);
      if (m && out.indexOf(m[1]) === -1) out.push(m[1]);
    }
    return out;
  }

  function cardWorkId(module) {
    var input = module.querySelector("input.workId");
    if (input && input.value) return input.value;
    var ids = hrefParams(module, "workId");
    return ids.length ? ids[0] : null;
  }

  function cardPartIds(module) {
    return hrefParams(module, "partId");
  }

  function cardTitle(module) {
    // ヘッダ付きカードは header p.line2 が作品名（このとき h3.line2 は話数サブタイトル）。
    // ヘッダなしは .textContainer の h3.line2 / .line1 span が作品名。
    var el =
      module.querySelector("section > header p.line2") ||
      module.querySelector(".textContainerIn .line1 span") ||
      module.querySelector(".textContainer h3.line2") ||
      module.querySelector("h3.line2");
    return el && el.textContent ? el.textContent.trim() : "";
  }

  function extractCards(doc) {
    // SP 用の .onlySpLayout ラッパは同じカードの複製なので除外する。
    var modules = doc.querySelectorAll(
      ".itemWrapper:not(.onlySpLayout) > .itemModule",
    );
    if (modules.length === 0) {
      modules = doc.querySelectorAll(".itemModule");
    }
    var out = [];
    for (var i = 0; i < modules.length; i++) {
      var m = modules[i];
      var title = cardTitle(m);
      var workId = cardWorkId(m);
      if (!title && !workId) continue;
      out.push({
        workId: workId || "title:" + title,
        title: title,
        partIds: cardPartIds(m),
      });
    }
    return out;
  }

  // 同一作品の重複（話数カードの分割・SP 複製の抜け漏れ）を workId で集約する。
  function mergeWorks(items) {
    var seen = {};
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var prev = seen[it.workId];
      if (prev) {
        for (var j = 0; j < it.partIds.length; j++) {
          if (prev.partIds.indexOf(it.partIds[j]) === -1) {
            prev.partIds.push(it.partIds[j]);
          }
        }
        if (!prev.title && it.title) prev.title = it.title;
        continue;
      }
      seen[it.workId] = it;
      out.push(it);
    }
    return out;
  }

  async function fetchList(path, query) {
    var doc = await fetchDoc(BASE + path + (query ? "?" + query : ""));
    var items = extractCards(doc);

    // pageForm の入力を丸ごと引き継いでページング URL を作る
    // （history は workType/editModeFlag/selectPage を持つ。実測済み）。
    var params = {};
    var form = doc.querySelector("form[name=pageForm]");
    if (form) {
      var inputs = form.querySelectorAll("input");
      for (var i = 0; i < inputs.length; i++) {
        var inp = inputs[i];
        if (inp.name) params[inp.name] = inp.value;
      }
    }

    var total = totalPages(doc);
    for (var page = 2; page <= total; page++) {
      params.selectPage = String(page);
      var qs = Object.keys(params)
        .map(function (k) {
          return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
        })
        .join("&");
      var d = await fetchDoc(BASE + path + "?" + qs);
      items = items.concat(extractCards(d));
    }
    return items;
  }

  // ---- 話単位の視聴済み抽出（issue #477）----
  // 作品ページ ci_pc?workId= には話カードが並び、視聴済みの話は
  // カード（.itemModule）に .watched が付く。同じ partId のカードが
  // 「続きから」用に重複して出るため、partId ごとに視聴済みフラグを
  // OR でまとめる（先頭のカードだけを見ると取りこぼす）。

  var PROGRESS_ID = "animeishi-danime-progress";

  // 抽出に数分かかるため、実行中であることと「タブを閉じないでほしい」ことを
  // ページ上のオーバーレイで示す。
  function showProgress(text) {
    try {
      var el = document.getElementById(PROGRESS_ID);
      if (!el) {
        el = document.createElement("div");
        el.id = PROGRESS_ID;
        el.setAttribute(
          "style",
          "position:fixed;top:8px;right:8px;z-index:2147483647;" +
            "background:rgba(30,30,60,0.92);color:#fff;font-size:12px;" +
            "padding:10px 14px;border-radius:8px;max-width:320px;" +
            "line-height:1.6;box-shadow:0 2px 8px rgba(0,0,0,0.3)",
        );
        document.body.appendChild(el);
      }
      el.textContent = text;
    } catch (e) {}
  }

  function hideProgress() {
    try {
      var el = document.getElementById(PROGRESS_ID);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    } catch (e) {}
  }

  function textOf(el) {
    return el && el.textContent ? el.textContent.trim() : "";
  }

  // element から最も近い話カード（.itemModule または祖先の .watched を
  // 持つ要素までの最小単位）を取る。closest の無い環境はほぼ無いが、
  // 保険として要素自身を返す。
  function episodeCard(el) {
    if (!el || !el.closest) return el;
    return el.closest(".itemModule") || el;
  }

  function isWatchedCard(card, el) {
    if (card.classList && card.classList.contains("watched")) return true;
    if (card.querySelector && card.querySelector(".watched")) return true;
    // カードが取れずリンクが直接 .watched の中にいる場合
    if (el && el.closest && el.closest(".watched")) return true;
    return false;
  }

  // 話カード内の話数表記・サブタイトルを拾う。
  // サムネイル側のリンクにはテキストが無いため、同じ partId の
  // テキストリンク側が後からラベルを補完できるよう先勝ちせず
  // 空欄は上書きマージする。
  function mergeEpisode(byPart, partId, card, link) {
    var label = "";
    var subtitle = "";
    if (card && card.querySelector) {
      var numEl =
        card.querySelector(".number") ||
        card.querySelector(".textContainer .line1") ||
        card.querySelector("h3.line1");
      label = textOf(numEl);
      var subEl =
        card.querySelector(".line2") || card.querySelector("h3.line2");
      subtitle = textOf(subEl);
    }
    if (!label) label = textOf(link);
    var watched = isWatchedCard(card, link);
    var prev = byPart[partId];
    if (prev) {
      prev.watched = prev.watched || watched;
      if (!prev.label && label) prev.label = label;
      if (!prev.subtitle && subtitle) prev.subtitle = subtitle;
    } else {
      byPart[partId] = {
        partId: partId,
        watched: watched,
        label: label,
        subtitle: subtitle,
      };
    }
  }

  // 作品ページの HTML から partId → 話情報の対応表を作る。
  // partId= クエリを持つリンクと、onclick に partId を埋めた
  // 再生ボタンの両方を走査する。
  function extractEpisodeCards(doc) {
    var byPart = {};
    var re = /[?&]partId=([^&#"']*)/;
    var links = doc.querySelectorAll("a[href]");
    var i, m;
    for (i = 0; i < links.length; i++) {
      m = (links[i].getAttribute("href") || "").match(re);
      if (!m || !m[1]) continue;
      var card = episodeCard(links[i]);
      mergeEpisode(byPart, m[1], card, links[i]);
    }
    var clickable = doc.querySelectorAll("[onclick]");
    for (i = 0; i < clickable.length; i++) {
      m = (clickable[i].getAttribute("onclick") || "").match(
        /partId=([^&#"']+)/,
      );
      if (!m || !m[1]) continue;
      var c2 = episodeCard(clickable[i]);
      mergeEpisode(byPart, m[1], c2, clickable[i]);
    }
    var out = [];
    for (var k in byPart) {
      if (Object.prototype.hasOwnProperty.call(byPart, k)) out.push(byPart[k]);
    }
    return out;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  // 視聴済み作品の話一覧を作品ページから集める。
  // 同一サイトへの数百リクエストになるため並列度は小さく（2）、
  // リクエスト開始間隔も空ける。失敗した作品は飛ばして続行する。
  var EPISODE_CONCURRENCY = 2;
  var EPISODE_FETCH_INTERVAL_MS = 150;

  async function fetchAllWorkEpisodes(workIds) {
    var episodes = {};
    var failures = 0;
    var next = 0;
    var done = 0;
    var nextAt = 0;
    var worker = async function () {
      while (next < workIds.length) {
        var workId = workIds[next++];
        // リクエスト開始間隔を揃える（workers 間で nextAt を共有）。
        var now = Date.now();
        var wait = nextAt - now;
        nextAt = (wait > 0 ? nextAt : now) + EPISODE_FETCH_INTERVAL_MS;
        if (wait > 0) await sleep(wait);
        try {
          var doc = await fetchDoc(
            BASE + "ci_pc?workId=" + encodeURIComponent(workId),
          );
          episodes[workId] = extractEpisodeCards(doc);
        } catch (e) {
          failures++;
        }
        done++;
        showProgress(
          "Animeishi: 話の情報を取得しています（" +
            done +
            " / " +
            workIds.length +
            " 作品）\n取得が終わるまでこのタブは閉じないでください。",
        );
      }
    };
    var workers = [];
    for (var i = 0; i < Math.min(EPISODE_CONCURRENCY, workIds.length); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return { episodes: episodes, failures: failures };
  }

  // 実行ページのオリジン検査。dアニメ以外のページ（アプリ側ページや
  // docomo ログイン画面）で実行すると same-origin でない fetch が CORS で
  // 失敗するため、先に分かりやすいエラーを返す。
  if (location.hostname !== "animestore.docomo.ne.jp") {
    if (appWin) {
      try {
        appWin.close();
      } catch (e) {}
    }
    report({ type: MSG_ERR, message: "wrong_page" });
    return;
  }

  try {
    // 抽出フェーズの所要時間を計測してレビュー画面へ可視化のため送る。
    var t0 = Date.now();
    var completed = mergeWorks(await fetchList("mpa_cmp_pc", ""));
    var history = mergeWorks(await fetchList("mpa_hst_pc", "workType=0"));
    if (completed.length === 0 && history.length === 0) {
      // 0 件は「本当に空」か「構造変更で取れていない」か区別がつかない。
      // ページがマイページ形式かどうかで判定する。
      throw new Error("empty_result");
    }

    // 話単位の視聴済み（issue #477）。数値 workId を持つ作品だけを対象に
    // 作品ページを追加取得する。タブを閉じると中断されるため、進捗は
    // ページ上のオーバーレイに出す。
    var episodeWorkIds = {};
    var allWorks = completed.concat(history);
    for (var wi = 0; wi < allWorks.length; wi++) {
      var wid = allWorks[wi].workId;
      if (/^\d+$/.test(wid)) episodeWorkIds[wid] = true;
    }
    var epResult = { episodes: {}, failures: 0 };
    var epTargets = Object.keys(episodeWorkIds);
    if (epTargets.length > 0) {
      try {
        epResult = await fetchAllWorkEpisodes(epTargets);
      } finally {
        hideProgress();
      }
    }

    report({
      type: MSG_OK,
      payload: {
        schemaVersion: SCHEMA_VERSION,
        completed: completed,
        history: history,
        extractElapsedMs: Date.now() - t0,
        episodes: epResult.episodes,
        episodeFetchFailures: epResult.failures,
      },
    });
  } catch (e) {
    hideProgress();
    report({
      type: MSG_ERR,
      message: e && e.message ? String(e.message) : String(e),
    });
  }
})();
`;
}

/**
 * ネイティブ WebView 注入用のスクリプト。ReactNativeWebView.postMessage に
 * 結果が返るため転送先オリジンは不要（空文字で window.open も起きない）。
 */
export const DANIME_EXTRACT_SCRIPT = danimeExtractScript("");

/**
 * Web 版でユーザーにブックマーク登録させるための javascript: URL。
 *
 * javascript: URL はブラウザが実行前に percent-decode する仕様のため、
 * スクリプト全体を encodeURIComponent して埋め込む。生埋め込みだと
 *   - 改行が除去され // 行コメントが後続コードを飲み込み構文エラーになる
 *   - 正規表現内の "#" が URL フラグメントとして後半を切り捨てる
 * という 2 つの破壊を受けるため、エンコード必須。
 *
 * @param appOrigin 抽出結果の転送先となる Animeishi Web のオリジン
 *   （呼び出し側で location.origin を渡す。デプロイ先で変わるため埋め込み必須）。
 */
export function buildDanimeBookmarklet(appOrigin: string): string {
  return `javascript:${encodeURIComponent(danimeExtractScript(appOrigin))}`;
}
