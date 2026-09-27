// dアニメストア マイページからの履歴抽出スクリプト。
//
// このファイルの文字列リテラルが「実行する JS 本体」。2 つの経路で共用する:
//   - ネイティブ: react-native-webview の injectJavaScript で animestore ドメイン上に注入。
//     結果は window.ReactNativeWebView.postMessage でアプリへ返る。
//   - Web: ブックマークレット（javascript: URL）としてブラウザ上で実行。
//     ReactNativeWebView が無いため、結果はクリップボードへコピーする。
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

export const DANIME_HISTORY_URL =
  "https://animestore.docomo.ne.jp/animestore/mpa_hst_pc?workType=0";

// 抽出メッセージの type 値（アプリ側の onMessage で識別する）。
export const DANIME_EXTRACT_OK = "animeishi:danime-extract";
export const DANIME_EXTRACT_ERR = "animeishi:danime-extract-error";

// 実行本体。async IIFE でそのまま評価できる形。
// テストでもこの文字列を eval して実行するため、モジュール import や
// モダン構文（optional chaining 等）は使わず ES2017 程度に留める。
export const DANIME_EXTRACT_SCRIPT = String.raw`
(async function () {
  var BASE = "https://animestore.docomo.ne.jp/animestore/";
  var MSG_OK = "${DANIME_EXTRACT_OK}";
  var MSG_ERR = "${DANIME_EXTRACT_ERR}";

  function report(obj) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(obj));
      return;
    }
    // ブックマークレット経路: postMessage の相手がいないのでクリップボードへ。
    if (obj.type === MSG_ERR) {
      var hints = {
        wrong_page:
          "dアニメストアのページ（animestore.docomo.ne.jp）を開いた状態で実行してください。",
        not_logged_in: "dアニメストアにログインしてから実行してください。",
        empty_result:
          "履歴データが取得できませんでした。履歴が空か、ページ構造が変更された可能性があります。",
        network_error:
          "通信に失敗しました。ネットワーク接続を確認してから実行してください。",
      };
      alert(
        "dアニメ履歴の取得に失敗しました。\n" +
          (hints[obj.message] || obj.message),
      );
      return;
    }
    var text = JSON.stringify(obj.payload);
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

  // 実行ページのオリジン検査。dアニメ以外のページ（アプリ側ページや
  // docomo ログイン画面）で実行すると same-origin でない fetch が CORS で
  // 失敗するため、先に分かりやすいエラーを返す。
  if (location.hostname !== "animestore.docomo.ne.jp") {
    report({ type: MSG_ERR, message: "wrong_page" });
    return;
  }

  try {
    var completed = mergeWorks(await fetchList("mpa_cmp_pc", ""));
    var history = mergeWorks(await fetchList("mpa_hst_pc", "workType=0"));
    if (completed.length === 0 && history.length === 0) {
      // 0 件は「本当に空」か「構造変更で取れていない」か区別がつかない。
      // ページがマイページ形式かどうかで判定する。
      throw new Error("empty_result");
    }
    report({
      type: MSG_OK,
      payload: { completed: completed, history: history },
    });
  } catch (e) {
    report({
      type: MSG_ERR,
      message: e && e.message ? String(e.message) : String(e),
    });
  }
})();
`;

/**
 * Web 版でユーザーにブックマーク登録させるための javascript: URL。
 *
 * javascript: URL はブラウザが実行前に percent-decode する仕様のため、
 * スクリプト全体を encodeURIComponent して埋め込む。生埋め込みだと
 *   - 改行が除去され // 行コメントが後続コードを飲み込み構文エラーになる
 *   - 正規表現内の "#" が URL フラグメントとして後半を切り捨てる
 * という 2 つの破壊を受けるため、エンコード必須。
 */
export function buildDanimeBookmarklet(): string {
  return `javascript:${encodeURIComponent(DANIME_EXTRACT_SCRIPT)}`;
}
