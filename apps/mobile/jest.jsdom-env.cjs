"use strict";

const { TestEnvironment } = require("jest-environment-jsdom");
const vm = require("node:vm");

/**
 * Jest 30.4+ の `Runtime.resetModules()` は teardown 時に
 * `moduleMocker.clearMocksOnScope(global)` で列挙可能なグローバルを全て読む。
 * Expo が遅延 getter で登録するグローバル（`fetch`・`structuredClone` 等）を
 * ここで読むと getter 内の `require` が "outside of the scope of the test code"
 * で落ちる。jest-expo の nativeEnvironment と同じく、アクセサは読まない
 * 実装に差し替える。
 *
 * @this {import('jest-mock').ModuleMocker}
 * @param {object} scope
 */
function clearMocksOnScope(scope) {
  for (const key of Object.keys(scope)) {
    const descriptor = Object.getOwnPropertyDescriptor(scope, key);
    if (!descriptor || typeof descriptor.get === "function") {
      continue;
    }
    const value = descriptor.value;
    if (
      value != null &&
      (typeof value === "object" || typeof value === "function") &&
      "_isMockFunction" in value &&
      this.isMockFunction(value) &&
      typeof value.mockClear === "function"
    ) {
      value.mockClear();
    }
  }
}

/**
 * jsdom テスト用の Jest 環境。
 *
 * jest 30 / jsdom 26 では `window` プロパティが jsdom Window の
 * 非 configurable なアクセサとして定義される。@react-native/jest-preset の
 * setup.js は `Object.defineProperties(global, { window: { value: global } })`
 * を無条件に実行するため、jsdom 環境では "Cannot redefine property: window"
 * で必ず落ちる（jest 29 / jsdom 20 では差し替え可能だった）。
 *
 * jsdom の Window をグローバルに使う代わりに、全プロパティを複写した
 * オブジェクトをコンテキスト化して使い、`window` 系の自己参照だけ
 * configurable に張り直す。getter は元の Window に束縛し直して、
 * `document` / `localStorage` など jsdom 内部を参照するアクセサが
 * 壊れないようにする。
 */
class PatchedJSDOMEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    const original = this.global;
    const copy = {};
    // `global` も Window 自身を指すため、window 同様に張り直す対象。
    const selfRefs = [
      "window",
      "self",
      "top",
      "parent",
      "frames",
      "globalThis",
      "global",
    ];
    for (const key of Reflect.ownKeys(original)) {
      if (selfRefs.includes(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(original, key);
      if (!descriptor) continue;
      if (descriptor.get) descriptor.get = descriptor.get.bind(original);
      if (descriptor.set) descriptor.set = descriptor.set.bind(original);
      try {
        // テストが window.location 等を差し替えられるよう configurable にする。
        // 差し替えは複写側だけに効き、元の jsdom Window は壊れない。
        Object.defineProperty(copy, key, { ...descriptor, configurable: true });
      } catch {
        // 複写できないプロパティは捨てる（document など主要なものは揃う）
      }
    }
    this.global = vm.createContext(copy);
    for (const key of selfRefs) {
      Object.defineProperty(this.global, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: this.global,
      });
    }
  }

  async setup() {
    await super.setup();
    // moduleMocker は setup() で this.global を束縛して作られるため、
    // 作られた後で clearMocksOnScope だけ差し替える。
    this.moduleMocker.clearMocksOnScope = clearMocksOnScope;
  }

  // jest-runtime は global ではなく getVmContext() の戻り値を実行コンテキスト
  // に使う。既定実装は jsdom の Window そのものを返すため、複写した
  // コンテキストを返すよう差し替える。
  getVmContext() {
    return this.global;
  }
}

module.exports = PatchedJSDOMEnvironment;
module.exports.TestEnvironment = PatchedJSDOMEnvironment;
