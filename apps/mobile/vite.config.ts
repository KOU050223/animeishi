// vp run 用のタスク定義（issue #246）。Metro / Expo はこのファイルを読まない。
export default {
  run: {
    tasks: {
      // jest-expo は Haste マップ等のキャッシュを OS の一時ディレクトリに持ち、
      // 自動入力追跡の対象外の状態に依存するため、まずはキャッシュしない。
      test: {
        command: "jest --passWithNoTests --maxWorkers=2",
        cache: false,
      },
    },
  },
};
