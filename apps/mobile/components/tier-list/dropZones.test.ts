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

  it("shiftAll で全矩形がずれ、ヒットテストが追従する", () => {
    const { result } = renderHook(() => useDropZoneRegistry());
    act(() => setupRows(result.current));

    // 下へ 50px スクロールした状況を再現する。コンテンツは画面上で
    // 50px 上に流れるため、矩形は dy=-50 でずれる。
    act(() => result.current.shiftAll(-50));

    // s は y:0-100 → -50-50、a は 100-200 → 50-150、
    // トレイは 200-300 → 150-250 にずれた。
    expect(result.current.hitTest(50, 50)).toBe("s");
    expect(result.current.hitTest(50, -25)).toBe("s");
    expect(result.current.hitTest(50, 51)).toBe("a");
    expect(result.current.hitTest(50, 175)).toBeNull();
  });

  it("shiftAll のたびにずらし世代（epoch）が増える", () => {
    // measureInWindow の遅れ応答がずらし前の位置で矩形を上書きしないよう、
    // DropZone は要求時・応答時の世代を比較する。そのカウンタの契約。
    const { result } = renderHook(() => useDropZoneRegistry());
    const before = result.current.epoch();

    act(() => result.current.shiftAll(-50));
    expect(result.current.epoch()).toBe(before + 1);
    act(() => result.current.shiftAll(-10));
    expect(result.current.epoch()).toBe(before + 2);
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

  it("再レンダリングしてもレジストリの参照が変わらない", () => {
    // DropZone は registry を effect の依存にしている。参照が毎回変わると
    // 親の再レンダリングごとに cleanup が走り、登録済みの矩形が消えて
    // ドラッグ中の hitTest が一切当たらなくなる。
    const { result, rerender } = renderHook(() => useDropZoneRegistry());
    const first = result.current;
    rerender({});
    expect(result.current).toBe(first);
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

describe("カード矩形（行内挿入位置のヒットテスト。issue #218）", () => {
  // 行 "s" の中に横並びで置いたカード 2 枚（60px 幅、4px 隙間）。
  function setupCards(registry: ReturnType<typeof useDropZoneRegistry>) {
    registry.registerCard(1, { x: 0, y: 0, width: 60, height: 116 });
    registry.registerCard(2, { x: 64, y: 0, width: 60, height: 116 });
  }

  it("カードの内側の点はそのカードの itemId と矩形を返す", () => {
    const { result } = renderHook(() => useDropZoneRegistry());
    act(() => setupCards(result.current));

    expect(result.current.hitTestCard(30, 50)).toEqual({
      itemId: 1,
      rect: { x: 0, y: 0, width: 60, height: 116 },
    });
    expect(result.current.hitTestCard(100, 50)?.itemId).toBe(2);
  });

  it("どのカードにも当たらない点は undefined を返す", () => {
    const { result } = renderHook(() => useDropZoneRegistry());
    act(() => setupCards(result.current));

    expect(result.current.hitTestCard(62, 50)).toBeUndefined();
    expect(result.current.hitTestCard(30, 200)).toBeUndefined();
  });

  it("excludeItemId に渡したカードは当たり判定から外れる", () => {
    // ドラッグ中のカードは指に追従して矩形がずれ得るため、自分自身には
    // 当たらないよう除外する（自分の上で離した判定を別カード扱いしない）。
    const { result } = renderHook(() => useDropZoneRegistry());
    act(() => setupCards(result.current));

    expect(result.current.hitTestCard(30, 50, 1)).toBeUndefined();
    expect(result.current.hitTestCard(30, 50, 2)?.itemId).toBe(1);
  });

  it("shiftAll でカード矩形も行と一緒にずれる", () => {
    const { result } = renderHook(() => useDropZoneRegistry());
    act(() => setupCards(result.current));
    act(() => result.current.shiftAll(-50));

    // y:0-116 → -50-66 にずれる。ずらした後の位置では当たり、
    // ずらし後の範囲外（y=100）では当たらない。
    expect(result.current.hitTestCard(30, -25)?.itemId).toBe(1);
    expect(result.current.hitTestCard(30, 100)).toBeUndefined();
  });

  it("remeasureAll はカードの measurer も呼ぶ", () => {
    const { result } = renderHook(() => useDropZoneRegistry());
    const measureCard = jest.fn();

    act(() => {
      result.current.registerCardMeasurer(1, measureCard);
    });
    act(() => result.current.remeasureAll());

    expect(measureCard).toHaveBeenCalledTimes(1);
  });

  it("registerCardMeasurer の解除関数を呼ぶと矩形も消える", () => {
    const { result } = renderHook(() => useDropZoneRegistry());
    act(() => setupCards(result.current));

    let unregister: (() => void) | undefined;
    act(() => {
      unregister = result.current.registerCardMeasurer(1, jest.fn());
    });
    act(() => unregister?.());

    expect(result.current.hitTestCard(30, 50)).toBeUndefined();
    expect(result.current.hitTestCard(100, 50)?.itemId).toBe(2);
  });
});
