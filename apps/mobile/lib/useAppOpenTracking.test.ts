import { AppState, type AppStateStatus } from "react-native";
import { renderHook } from "@testing-library/react-native";
import { useAppOpenTracking } from "./useAppOpenTracking";
import { trackEvent } from "./events";

jest.mock("./events", () => ({ trackEvent: jest.fn() }));

const trackEventMock = jest.mocked(trackEvent);

function captureAppStateListener() {
  let listener: ((state: AppStateStatus) => void) | undefined;
  const remove = jest.fn();
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_type, handler) => {
      listener = handler;
      return { remove };
    });
  return {
    emit: (state: AppStateStatus) => listener?.(state),
    remove,
  };
}

beforeEach(() => {
  trackEventMock.mockClear();
  jest.restoreAllMocks();
});

describe("useAppOpenTracking", () => {
  it("起動時に app_open を送る", async () => {
    captureAppStateListener();
    await renderHook(() => useAppOpenTracking());
    expect(trackEventMock).toHaveBeenCalledTimes(1);
    expect(trackEventMock).toHaveBeenCalledWith("app_open");
  });

  it("バックグラウンドからの復帰で送り、inactive からの戻りでは送らない", async () => {
    const appState = captureAppStateListener();
    await renderHook(() => useAppOpenTracking());
    trackEventMock.mockClear();

    appState.emit("inactive");
    appState.emit("active");
    expect(trackEventMock).not.toHaveBeenCalled();

    appState.emit("background");
    appState.emit("active");
    expect(trackEventMock).toHaveBeenCalledTimes(1);
    expect(trackEventMock).toHaveBeenCalledWith("app_open");
  });

  it("アンマウントで購読を解除する", async () => {
    const appState = captureAppStateListener();
    const { unmount } = await renderHook(() => useAppOpenTracking());
    await unmount();
    expect(appState.remove).toHaveBeenCalledTimes(1);
  });
});
