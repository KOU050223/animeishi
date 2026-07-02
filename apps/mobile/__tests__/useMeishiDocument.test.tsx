import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useMeishiDocument } from "@/lib/meishi/useMeishiDocument";
import {
  loadMeishiDocument,
  saveMeishiDocument,
} from "@/lib/meishi/storage";
import type { MeishiDocument } from "@/lib/meishi/types";

jest.mock("@/lib/meishi/storage", () => ({
  clearMeishiDocument: jest.fn(),
  loadMeishiDocument: jest.fn(),
  saveMeishiDocument: jest.fn(),
}));

const mockLoadMeishiDocument = jest.mocked(loadMeishiDocument);
const mockSaveMeishiDocument = jest.mocked(saveMeishiDocument);

const sampleDoc: MeishiDocument = {
  version: 1,
  canvas: {
    aspectRatio: 1.6,
    background: { kind: "solid", color: "#ffffff" },
  },
  elements: [],
};

const updatedDoc: MeishiDocument = {
  ...sampleDoc,
  canvas: {
    ...sampleDoc.canvas,
    background: { kind: "solid", color: "#111827" },
  },
};

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  mockLoadMeishiDocument.mockResolvedValue(null);
  mockSaveMeishiDocument.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useMeishiDocument の永続化", () => {
  it("ドキュメント変更だけでは自動保存しない", async () => {
    const { result } = renderHook(() => useMeishiDocument());

    await waitFor(() => expect(result.current.loaded).toBe(true));

    jest.useFakeTimers();
    act(() => {
      result.current.setDocFromTemplate(sampleDoc);
    });
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(mockSaveMeishiDocument).not.toHaveBeenCalled();
  });

  it("saveDocument を呼んだ時だけ現在のドキュメントを保存する", async () => {
    const { result } = renderHook(() => useMeishiDocument());

    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.setDocFromTemplate(sampleDoc);
    });
    await waitFor(() => expect(result.current.doc).toEqual(sampleDoc));

    await act(async () => {
      await result.current.saveDocument();
    });

    expect(mockSaveMeishiDocument).toHaveBeenCalledTimes(1);
    expect(mockSaveMeishiDocument).toHaveBeenCalledWith(sampleDoc);
  });

  it("reloadDocument で保存済みドキュメントを再読み込みする", async () => {
    const { result } = renderHook(() => useMeishiDocument());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.doc).toBeNull();

    mockLoadMeishiDocument.mockResolvedValue(updatedDoc);

    await act(async () => {
      await result.current.reloadDocument();
    });

    expect(result.current.doc).toEqual(updatedDoc);
  });
});
