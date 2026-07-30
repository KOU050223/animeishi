import { renderHook, act } from "@testing-library/react-native";
import { useDropZoneRegistry } from "./dropZones";

/**
 * 行が縦に積まれた盤面を模した矩形。
 * y が 0-100 / 100-200 / 200-300 と隙間なく並ぶ。
 */
function setupRows(registry: ReturnType<typeof useDropZoneRegistry>) {
  registry.register("s", { x: 0, y: 0, width: 300, height: 100 });
  registry.register("a", { x: 0, y: 100, width: 300, height: 100 });
  registry.register(null, { x: 0, y: 200, width: 300, height: 100 });
}

describe("useDropZoneRegistry", () => {
  it("矩形の内側の点は、その行のキーを返す", () => {
    const { result } = renderHook(() => useDropZoneRegistry());
    act(() => setupRows(result.current));

    expect(result.current.hitTest(50, 50)).toBe("s");
    expect(result.current.hitTest(50, 150)).toBe("a");
  });

  it("未分類トレイ（null キー）を区別して返す", () => {
    const { result } = renderHook(() => useDropZoneRegistry());
    act(() => setupRows(result.current));

    // null は「トレイに落ちた」、undefined は「どこにも落ちていない」で意味が違う。
    expect(result.current.hitTest(50, 250)).toBeNull();
  });

  it("どの矩形にも入らない点は undefined を返す", () => {
    const { result } = renderHook(() => useDropZoneRegistry());
    act(() => setupRows(result.current));

    expect(result.current.hitTest(50, 500)).toBeUndefined();
    expect(result.current.hitTest(500, 50)).toBeUndefined();
  });

  it("行の境界では下側の行に入る（隣接行の取り合いで上にズレない）", () => {
    const { result } = renderHook(() => useDropZoneRegistry());
    act(() => setupRows(result.current));

    // y=100 は s(0-100) と a(100-200) の両方に含まれる。登録順で s が先に
    // ヒットするため、境界ちょうどより 1px 下は必ず a でなければならない。
    expect(result.current.hitTest(50, 101)).toBe("a");
  });

  it("register で同じキーを再登録すると矩形が更新される（スクロール後の測り直し）", () => {
    const { result } = renderHook(() => useDropZoneRegistry());
    act(() => setupRows(result.current));

    // スクロールで 100px 上にずれた状況を再現する。
    act(() => {
      result.current.register("s", { x: 0, y: -100, width: 300, height: 100 });
    });

    // 旧位置(y=50)には居らず、新位置(y=-50)で当たる。
    expect(result.current.hitTest(50, 50)).not.toBe("s");
    expect(result.current.hitTest(50, -50)).toBe("s");
  });

  it("remeasureAll は登録済みの measurer を全て呼ぶ", () => {
    const { result } = renderHook(() => useDropZoneRegistry());
    const measureS = jest.fn();
    const measureTray = jest.fn();

    act(() => {
      result.current.registerMeasurer("s", measureS);
      result.current.registerMeasurer(null, measureTray);
    });
    act(() => result.current.remeasureAll());

    expect(measureS).toHaveBeenCalledTimes(1);
    expect(measureTray).toHaveBeenCalledTimes(1);
  });

  it("registerMeasurer の解除関数を呼ぶと remeasureAll で呼ばれなくなる", () => {
    const { result } = renderHook(() => useDropZoneRegistry());
    const measure = jest.fn();

    let unregister: (() => void) | undefined;
    act(() => {
      unregister = result.current.registerMeasurer("s", measure);
    });
    act(() => unregister?.());
    act(() => result.current.remeasureAll());

    expect(measure).not.toHaveBeenCalled();
  });

  it("同じキーが別の measurer で上書きされた後の解除は、新しい方を消さない", () => {
    const { result } = renderHook(() => useDropZoneRegistry());
    const oldMeasure = jest.fn();
    const newMeasure = jest.fn();

    // 行の入れ替えで「新しい方が登録 → 古い方が解除」の順になるケース。
    let unregisterOld: (() => void) | undefined;
    act(() => {
      unregisterOld = result.current.registerMeasurer("s", oldMeasure);
      result.current.registerMeasurer("s", newMeasure);
    });
    act(() => unregisterOld?.());
    act(() => result.current.remeasureAll());

    expect(newMeasure).toHaveBeenCalledTimes(1);
    expect(oldMeasure).not.toHaveBeenCalled();
  });
});
