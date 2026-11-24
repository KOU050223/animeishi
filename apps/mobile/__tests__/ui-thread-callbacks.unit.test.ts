import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

// UI スレッドの worklet から JS 関数を直接呼ぶ書き方を検出する（issue #784）。
// Gesture のコールバック（onStart / onUpdate / onEnd / onFinalize 等）や
// useAnimatedStyle 系のコールバックは UI ランタイムで実行される worklet に
// なり、中から JS 側の関数をそのまま呼ぶと
// "Tried to synchronously call a Remote Function" でクラッシュする。
// JS 側へ戻すには scheduleOnRN（または runOnJS）を通す必要がある。
// oxlint にはこれを表せるルールが無いため、ソースを走査して検査する。
//
// 検出は命名規約ベース: UI スレッドで動くコールバック本体に onXxx という
// 名前（props コールバックの慣例名）の関数呼び出しがあれば違反とみなす。
// scheduleOnRN / runOnJS に包まれた関数参照は呼び出しではないので素通しする
// （逆に scheduleOnRN(fn, onXxx()) のように引数を UI スレッドで評価する
// 書き方も違反として検出する）。
// .runOnJS(true) を付けたジェスチャはコールバックが JS スレッドで動くため
// 対象外とする。
//
// 走査の限界: ジェスチャは `Gesture.X().onYyy(...)` のように
// メソッドチェーンで組み立てられたものだけを対象にする
// （`const g = Gesture.Tap(); g.onEnd(...)` のように文を分けた登録は
// 拾わない）。このコードベースのジェスチャはすべてチェーン組み立てなので
// その規約に頼る。
const SCAN_DIRS = ["app", "components", "lib"];
const EXCLUDED_DIRS = new Set([
  "__mocks__",
  "__tests__",
  "e2e",
  "test-utils",
  "node_modules",
]);
const SOURCE_FILE = /\.[jt]sx?$/;
const TEST_FILE = /\.(unit\.)?test\.[jt]sx?$/;
const TYPE_DECLARATION = /\.d\.ts$/;

const rootDir = path.resolve(__dirname, "..");

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name))
        files.push(...collectSourceFiles(entryPath));
    } else if (
      SOURCE_FILE.test(entry.name) &&
      !TEST_FILE.test(entry.name) &&
      !TYPE_DECLARATION.test(entry.name)
    ) {
      files.push(entryPath);
    }
  }
  return files;
}

// 文字列リテラル・コメントの中身を空白に潰す。文字列中の括弧や
// "onEnd(" のような断片をコードと誤認しないため。改行は残す
// （マスク前後で行番号を一致させるため）。
function maskNonCode(source: string): string {
  const chars = source.split("");
  const n = source.length;
  let i = 0;
  while (i < n) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") chars[i++] = " ";
    } else if (c === "/" && source[i + 1] === "*") {
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] !== "\n") chars[i] = " ";
        i++;
      }
      if (i < n) {
        chars[i] = " ";
        chars[i + 1] = " ";
        i += 2;
      }
    } else if (c === '"' || c === "'") {
      const quote = c;
      chars[i++] = " ";
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\") {
          chars[i] = " ";
          i++;
        }
        if (i < n && source[i] !== "\n") chars[i] = " ";
        i++;
      }
      if (i < n) chars[i++] = " ";
    } else if (c === "`") {
      i = maskTemplateLiteral(source, chars, i);
    } else {
      i++;
    }
  }
  return chars.join("");
}

// テンプレートリテラルをマスクする。`...${...}` のリテラル部分だけを潰し、
// ${} の中の式はコードとして残す（worklet 内の `${onXxx()}` も検出するため）。
// start は ` の位置。戻り値は終端 ` の直後の位置。
function maskTemplateLiteral(
  source: string,
  chars: string[],
  start: number,
): number {
  const n = source.length;
  chars[start] = " ";
  let i = start + 1;
  while (i < n && source[i] !== "`") {
    if (source[i] === "\\") {
      chars[i] = " ";
      i++;
      if (i < n && source[i] !== "\n") chars[i] = " ";
      i++;
      continue;
    }
    if (source[i] === "$" && source[i + 1] === "{") {
      chars[i] = " ";
      chars[i + 1] = " ";
      i += 2;
      // ${} の中身は式なのでマスクしない。文字列・コメント・ネストした
      // ブレースを読み飛ばしながら対応する } まで進める。
      let depth = 1;
      while (i < n && depth > 0) {
        const c = source[i];
        if (c === "/" && source[i + 1] === "/") {
          while (i < n && source[i] !== "\n") chars[i++] = " ";
          continue;
        }
        if (c === "/" && source[i + 1] === "*") {
          while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
            if (source[i] !== "\n") chars[i] = " ";
            i++;
          }
          if (i < n) {
            chars[i] = " ";
            chars[i + 1] = " ";
            i += 2;
          }
          continue;
        }
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            chars[i] = " ";
            i++;
            break;
          }
        } else if (c === '"' || c === "'") {
          const quote = c;
          chars[i] = " ";
          i++;
          while (i < n && source[i] !== quote) {
            if (source[i] === "\\") {
              chars[i] = " ";
              i++;
            }
            if (i < n && source[i] !== "\n") chars[i] = " ";
            i++;
          }
          if (i < n) chars[i++] = " ";
          continue;
        } else if (c === "`") {
          i = maskTemplateLiteral(source, chars, i);
          continue;
        }
        i++;
      }
      continue;
    }
    if (source[i] !== "\n") chars[i] = " ";
    i++;
  }
  if (i < n) chars[i] = " ";
  return i + 1;
}

// masked[open] が '(' のとき、対応する ')' の直後の位置を返す。失敗時は -1。
function callEnd(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

// pos から続く `.name(...)` の連鎖（メソッドチェーン）の終端を返す。
function methodChainEnd(masked: string, pos: number): number {
  for (;;) {
    while (/\s/.test(masked.charAt(pos))) pos++;
    const m = /^\.[A-Za-z_$][\w$]*\s*\(/.exec(masked.slice(pos));
    if (!m) return pos;
    const end = callEnd(masked, pos + m[0].length - 1);
    if (end === -1) return pos;
    pos = end;
  }
}

// Gesture.X() で始まるジェスチャ生成式。
const GESTURE_START = /\bGesture\.[A-Za-z_$][\w$]*\s*\(/g;
// ジェスチャのコールバック登録メソッド（.onStart / .onUpdate / ... 全般）。
const CALLBACK_METHOD = /\.(on[A-Z]\w*)\s*\(/g;
// コールバックを UI スレッドで実行するフック・関数。引数の関数がそのまま
// worklet になるため、呼び出し全体を検査する。
const UI_THREAD_HOOK =
  /\b(useAnimatedStyle|useAnimatedProps|useAnimatedReaction|useDerivedValue|useAnimatedScrollHandler|useAnimatedGestureHandler|useFrameCallback|runOnUI|executeOnUIRuntimeSync)\s*\(/g;
// 完了コールバックを取るアニメーション関数。コールバックは最後の引数で、
// それより前の引数（目標値・設定）は呼び出し側のスレッドで評価されるため
// 最後の引数だけを検査する。withSequence / withRepeat / withDelay は
// コールバックを直接取らないため対象外（内側の withTiming 等は個別に拾う）。
const UI_THREAD_ANIMATION = /\b(withTiming|withSpring|withDecay)\s*\(/g;
// JS 側コールバックの呼び出し（onXxx(...) / onXxx?.(...) / ref 経由）。
const JS_CALL = /\bon[A-Z]\w*(?:\.current)?\s*(?:\?\.)?\s*\(/g;

type CallbackBody = { body: string; offset: number };

// UI スレッドで実行されるコールバック本体（引数の中身）を列挙する。
// offset はマスク済みソース内での位置（= 元ソースの位置）。
function uiThreadCallbackBodies(masked: string): CallbackBody[] {
  const bodies: CallbackBody[] = [];

  for (const m of masked.matchAll(GESTURE_START)) {
    const openParen = m.index + m[0].length - 1;
    const initEnd = callEnd(masked, openParen);
    if (initEnd === -1) continue;
    const chainEnd = methodChainEnd(masked, initEnd);
    const chain = masked.slice(m.index, chainEnd);
    // .runOnJS(true) のジェスチャはコールバックが JS スレッドで実行される。
    if (/\.runOnJS\(\s*true\s*\)/.test(chain)) continue;
    for (const cm of chain.matchAll(CALLBACK_METHOD)) {
      const open = m.index + cm.index + cm[0].length - 1;
      const end = callEnd(masked, open);
      if (end !== -1)
        bodies.push({ body: masked.slice(open, end), offset: open });
    }
  }

  for (const m of masked.matchAll(UI_THREAD_HOOK)) {
    const open = m.index + m[0].length - 1;
    const end = callEnd(masked, open);
    if (end !== -1)
      bodies.push({ body: masked.slice(open, end), offset: open });
  }

  // withTiming 系は最後の引数（完了コールバック）だけを検査する。
  for (const m of masked.matchAll(UI_THREAD_ANIMATION)) {
    const open = m.index + m[0].length - 1;
    const end = callEnd(masked, open);
    if (end === -1) continue;
    const args = topLevelArgs(masked.slice(open, end));
    const last = args.at(-1);
    if (last !== undefined) {
      bodies.push({ body: last.text, offset: open + last.offset });
    }
  }

  return bodies;
}

// `(a, b, c)` 形の呼び出し文字列を、最上位のカンマで引数に分割する。
// offset は呼び出し文字列内での位置。
function topLevelArgs(call: string): { text: string; offset: number }[] {
  const args: { text: string; offset: number }[] = [];
  let depth = 0;
  let start = 1; // 先頭の '(' の次から
  const last = call.length - 1; // 末尾の ')' の手前まで
  for (let i = start; i < last; i++) {
    const c = call[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      args.push({ text: call.slice(start, i), offset: start });
      start = i + 1;
    }
  }
  args.push({ text: call.slice(start, last), offset: start });
  return args;
}

// source 中の違反（UI スレッドのコールバックからの onXxx 直接呼び出し）を
// "行番号: 呼び出し" の形で返す。
function findDirectJsCalls(source: string): { line: number; call: string }[] {
  const masked = maskNonCode(source);
  const found = new Map<number, { line: number; call: string }>();
  for (const { body, offset } of uiThreadCallbackBodies(masked)) {
    for (const jm of body.matchAll(JS_CALL)) {
      const position = offset + jm.index;
      if (found.has(position)) continue;
      found.set(position, {
        line: masked.slice(0, position).split("\n").length,
        call: jm[0],
      });
    }
  }
  return [...found.values()];
}

describe("UI スレッドの worklet からの JS 関数直接呼び出し（issue #784）", () => {
  const files = SCAN_DIRS.flatMap((dir) =>
    collectSourceFiles(path.join(rootDir, dir)),
  );

  test("ジェスチャ・アニメーションのコールバックから onXxx を直接呼ばない", () => {
    const violations = files.flatMap((file) =>
      findDirectJsCalls(fs.readFileSync(file, "utf8")).map(
        ({ line, call }) => `${path.relative(rootDir, file)}:${line} ${call}`,
      ),
    );
    expect(violations).toEqual([]);
  });

  test("走査自体が機能することを合成コードで確認する", () => {
    const violating = `
      const pan = Gesture.Pan()
        .onUpdate(() => {
          onTransform({ x: 1 });
        })
        .onEnd(() => {
          onCommit?.();
        });
      // scheduleOnRN の引数も UI スレッドで評価されるため直接呼び出しは違反。
      const bad = Gesture.Tap()
        .onEnd(() => scheduleOnRN(onSelect, onBeforeSelect()));
      // withTiming の完了コールバック（最後の引数）も UI スレッドで動く。
      const animated = withTiming(1, { duration: 100 }, () => onFinished());
      // テンプレートリテラルの補間式も実行される。
      const label = Gesture.Tap().onEnd(() => \`\${onSelect()}\`);
    `;
    expect(findDirectJsCalls(violating)).toHaveLength(5);

    const safe = `
      const pan = Gesture.Pan()
        .onUpdate(() => {
          scheduleOnRN(onTransform, { x: 1 });
        })
        .onEnd(() => {
          if (onCommit) scheduleOnRN(onCommit);
        });
      const onJs = Gesture.Tap()
        .runOnJS(true)
        .onEnd(() => onSelect(null));
      // 完了コールバックより前の引数は呼び出し側のスレッドで評価される。
      const animated = withTiming(onTarget(), { duration: 100 });
    `;
    expect(findDirectJsCalls(safe)).toEqual([]);
  });
});
