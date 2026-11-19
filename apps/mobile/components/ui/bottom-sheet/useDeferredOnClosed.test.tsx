import { act, renderHook } from "@testing-library/react-native";
import { useDeferredOnClosed } from "./useDeferredOnClosed";

describe("useDeferredOnClosed", () => {
  it("閉じる途中で再び開いた場合は次のモーダルを表示しない", async () => {
    jest.useFakeTimers();
    const onClosed = jest.fn();
    const { rerender, unmount } = await renderHook<void, { visible: boolean }>(
      ({ visible }) => useDeferredOnClosed(visible, onClosed),
      { initialProps: { visible: true } },
    );

    await rerender({ visible: false });
    await rerender({ visible: true });
    await act(async () => jest.runAllTimers());
    expect(onClosed).not.toHaveBeenCalled();

    await rerender({ visible: false });
    await act(async () => jest.runAllTimers());
    expect(onClosed).toHaveBeenCalledTimes(1);
    await unmount();
    jest.useRealTimers();
  });
});
