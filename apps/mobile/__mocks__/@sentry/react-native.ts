// jest 環境で @sentry/react-native を差し替える軽量スタブ。
// ネイティブモジュールを持たず、init / capture は呼び出し記録だけを残す。
export const init = jest.fn();
export const captureException = jest.fn();
export const nativeCrash = jest.fn();
export const wrap = <T>(component: T): T => component;
export const withScope = (
  callback: (scope: {
    setTag: (key: string, value: string) => void;
    setContext: (key: string, context: Record<string, unknown>) => void;
  }) => void,
): void =>
  callback({
    setTag: () => {},
    setContext: () => {},
  });
export const getGlobalScope = () => ({
  setTag: () => {},
  setContext: () => {},
});
