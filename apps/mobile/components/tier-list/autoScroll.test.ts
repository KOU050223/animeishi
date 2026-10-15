import { act, renderHook } from "@testing-library/react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import {
  AUTO_SCROLL_EDGE_PX,
  autoScrollDirection,
  nextScrollOffset,
  useEdgeAutoScroll,
  type ViewportRect,
} from "./autoScroll";
import { useDropZoneRegistry } from "./dropZones";

// ビューポート: 画面上 y=100 から高さ 600（下端 700）。
// 端判定は上下 56px（AUTO_SCROLL_EDGE_PX）なので、上端帯は 100-156、
// 下端帯は 644-700。
const VIEWPORT: ViewportRect = { y: 100, height: 600 };

describe("autoScrollDirection", () => {
  it("上端の近くでは上方向（-1）を返す", () => {
    expect(autoScrollDirection(VIEWPORT.y + 10, VIEWPORT)).toBe(-1);
  });

  it("下端の近くでは下方向（1）を返す", () => {
    expect(
      autoScrollDirection(VIEWPORT.y + VIEWPORT.height - 10, VIEWPORT),
    ).toBe(1);
  });

  it("中央では 0 を返す", () => {
    expect(autoScrollDirection(VIEWPORT.y + 300, VIEWPORT)).toBe(0);
  });

  it("ビューポートの外に出ても端方向を維持する", () => {
    // 盤面より上のヘッダ領域に指が入っても上へスクロールし続ける。
    expect(autoScrollDirection(VIEWPORT.y - 20, VIEWPORT)).toBe(-1);
    expect(
      autoScrollDirection(VIEWPORT.y + VIEWPORT.height + 20, VIEWPORT),
    ).toBe(1);
  });
});

describe("nextScrollOffset", () => {
  it("下方向はオフセットを増やし、上方向は減らす", () => {
    expect(nextScrollOffset(0, 1, 695, VIEWPORT, 1000)).toBeGreaterThan(0);
    expect(nextScrollOffset(500, -1, 105, VIEWPORT, 1000)).toBeLessThan(500);
  });

  it("端に近いほど速く進む", () => {
    const nearEdge = nextScrollOffset(0, 1, 699, VIEWPORT, 1000);
    const farFromEdge = nextScrollOffset(0, 1, 650, VIEWPORT, 1000);
    expect(nearEdge).toBeGreaterThan(farFromEdge);
  });

  it("コンテンツの上下端で clamp する", () => {
    expect(nextScrollOffset(995, 1, 699, VIEWPORT, 1000)).toBe(1000);
    expect(nextScrollOffset(2, -1, 101, VIEWPORT, 1000)).toBe(0);
    // コンテンツがビューポートより小さい（maxOffset=0）なら動かない
    expect(nextScrollOffset(0, 1, 699, VIEWPORT, 0)).toBe(0);
  });

  it("方向が 0 なら動かない", () => {
    expect(nextScrollOffset(100, 0, 400, VIEWPORT, 1000)).toBe(100);
  });
});

describe("useEdgeAutoScroll", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function setup(options: { viewport?: ViewportRect | null } = {}) {
    const scrollTo = jest.fn();
    const scrollCompensation = { value: 0 };
    const onScrolled = jest.fn();
    const viewport =
      options.viewport === undefined ? VIEWPORT : options.viewport;
    const viewportRef = {
      current: viewport
        ? {
            measureInWindow: (
              cb: (x: number, y: number, w: number, h: number) => void,
            ) => cb(0, viewport.y, 400, viewport.height),
          }
        : null,
    };
    const scrollRef = { current: { scrollTo } };
    const hook = renderHook(() => {
      const registry = useDropZoneRegistry();
      const autoScroll = useEdgeAutoScroll({
        scrollRef,
        viewportRef,
        registry,
        scrollCompensation,
        onScrolled,
      });
      return { registry, autoScroll };
    });
    return { hook, scrollTo, scrollCompensation, onScrolled };
  }

  it("指が下端にいる間、tick ごとに下へスクロールする", () => {
    const { hook, scrollTo, onScrolled } = setup();
    act(() => hook.result.current.autoScroll.onContentSizeChange(0, 2000));
    act(() => hook.result.current.autoScroll.onDragStart());
    // 下端帯（644-700）に指を置く
    act(() => hook.result.current.autoScroll.onDragMove(50, 695));
    act(() => {
      jest.advanceTimersByTime(50);
    });

    expect(scrollTo).toHaveBeenCalled();
    const lastY = scrollTo.mock.calls.at(-1)?.[0].y as number;
    expect(lastY).toBeGreaterThan(0);
    // 指を止めていても進んだ分だけ onScrolled で指位置が通知される
    // （呼び出し側がハイライトを追従させるため）
    expect(onScrolled).toHaveBeenCalledWith(50, 695);
  });

  it("指が中央にあるときはスクロールしない", () => {
    const { hook, scrollTo } = setup();
    act(() => hook.result.current.autoScroll.onContentSizeChange(0, 2000));
    act(() => hook.result.current.autoScroll.onDragStart());
    act(() => hook.result.current.autoScroll.onDragMove(50, 400));
    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("スクロールした分だけ登録済み矩形がずれ、ヒットテストが追従する", () => {
    const { hook, scrollTo, scrollCompensation } = setup();
    act(() =>
      hook.result.current.registry.register("s", {
        x: 0,
        y: 0,
        width: 400,
        height: 100,
      }),
    );
    act(() => hook.result.current.autoScroll.onContentSizeChange(0, 2000));
    act(() => hook.result.current.autoScroll.onDragStart());
    act(() => hook.result.current.autoScroll.onDragMove(50, 695));
    act(() => {
      jest.advanceTimersByTime(50);
    });

    const scrolled = scrollTo.mock.calls.at(-1)?.[0].y as number;
    expect(scrolled).toBeGreaterThan(0);
    // カード追従用の補正量はスクロール量と一致する
    expect(scrollCompensation.value).toBeCloseTo(scrolled);
    // 矩形はコンテンツと一緒に上へ流れる（y が減る）ため、
    // ずらした後の位置（scrolled 分だけ上）でヒットする
    expect(hook.result.current.registry.hitTest(50, -scrolled + 50)).toBe("s");
  });

  it("コンテンツの下端に達するとそれ以上進まない", () => {
    const { hook, scrollTo } = setup();
    // コンテンツ高 700 = ビューポート 600 + 100px 分しかスクロールできない
    act(() => hook.result.current.autoScroll.onContentSizeChange(0, 700));
    act(() =>
      hook.result.current.autoScroll.onScroll({
        nativeEvent: { contentOffset: { y: 90 } },
      } as NativeSyntheticEvent<NativeScrollEvent>),
    );
    act(() => hook.result.current.autoScroll.onDragStart());
    act(() => hook.result.current.autoScroll.onDragMove(50, 695));
    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(scrollTo).toHaveBeenCalled();
    for (const call of scrollTo.mock.calls) {
      expect(call[0].y).toBeLessThanOrEqual(100);
    }
    expect(scrollTo.mock.calls.at(-1)?.[0].y).toBe(100);
  });

  it("ドラッグ終了でタイマーが止まり、補正量がリセットされる", () => {
    const { hook, scrollTo, scrollCompensation } = setup();
    act(() => hook.result.current.autoScroll.onContentSizeChange(0, 2000));
    act(() => hook.result.current.autoScroll.onDragStart());
    act(() => hook.result.current.autoScroll.onDragMove(50, 695));
    act(() => {
      jest.advanceTimersByTime(50);
    });
    const callsAtEnd = scrollTo.mock.calls.length;
    expect(callsAtEnd).toBeGreaterThan(0);
    expect(scrollCompensation.value).toBeGreaterThan(0);

    act(() => hook.result.current.autoScroll.onDragEnd());
    expect(scrollCompensation.value).toBe(0);

    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(scrollTo.mock.calls.length).toBe(callsAtEnd);
  });

  it("ビューポートが未計測ならスクロールしない", () => {
    const { hook, scrollTo } = setup({ viewport: null });
    act(() => hook.result.current.autoScroll.onContentSizeChange(0, 2000));
    act(() => hook.result.current.autoScroll.onDragStart());
    act(() => hook.result.current.autoScroll.onDragMove(50, 695));
    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("アンマウント後はタイマーが止まっている", () => {
    const { hook, scrollTo } = setup();
    act(() => hook.result.current.autoScroll.onContentSizeChange(0, 2000));
    act(() => hook.result.current.autoScroll.onDragStart());
    act(() => hook.result.current.autoScroll.onDragMove(50, 695));

    hook.unmount();
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("AUTO_SCROLL_EDGE_PX の端境界ちょうど外側では動かない", () => {
    const { hook, scrollTo } = setup();
    act(() => hook.result.current.autoScroll.onContentSizeChange(0, 2000));
    act(() => hook.result.current.autoScroll.onDragStart());
    // 下端帯の 1px 外側（644 ちょうどは帯の内側ではない）
    act(() =>
      hook.result.current.autoScroll.onDragMove(
        50,
        VIEWPORT.y + VIEWPORT.height - AUTO_SCROLL_EDGE_PX,
      ),
    );
    act(() => {
      jest.advanceTimersByTime(50);
    });

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
