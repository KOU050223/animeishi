/**
 * db.select / db.update が呼ばれた回数だけ err を投げるラッパ。
 * Miniflare の D1 は internal error を自発的に起こせないため、
 * drizzle クライアントの呼び出し口を Proxy で差し替えて再現する。
 */
export function flakyD1Db<T extends object>(
  base: T,
  err: Error,
  failures: { select?: number; update?: number },
): T {
  const left = { select: failures.select ?? 0, update: failures.update ?? 0 };
  return new Proxy(base, {
    get(target, prop) {
      const kind =
        prop === "select" ? "select" : prop === "update" ? "update" : null;
      if (kind && left[kind] > 0) {
        left[kind]--;
        return () => {
          throw err;
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
