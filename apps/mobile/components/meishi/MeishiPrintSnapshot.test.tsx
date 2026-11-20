import React, { createRef } from "react";
import { render, screen } from "@testing-library/react-native";
import type { ViewInstance } from "react-native";
import { MeishiPrintSnapshot } from "./MeishiPrintSnapshot";
import type { MeishiDocument, MeishiRenderContext } from "@/lib/meishi/types";

const doc: MeishiDocument = {
  version: 1,
  canvas: {
    aspectRatio: 1.6,
    background: { kind: "solid", color: "#ffffff" },
  },
  elements: [],
};

const baseContext: MeishiRenderContext = {
  profile: { profileUrl: "https://example.com/user/u1" },
};

describe("MeishiPrintSnapshot", () => {
  it("表・裏のキャプチャ対象がそれぞれの ref に入り、画像がなければ即座に ready になる", async () => {
    const frontRef = createRef<ViewInstance>();
    const backRef = createRef<ViewInstance>();
    const onReady = jest.fn();

    await render(
      <MeishiPrintSnapshot
        document={doc}
        context={baseContext}
        frontRef={frontRef}
        backRef={backRef}
        onReady={onReady}
      />,
    );

    expect(frontRef.current).toBeTruthy();
    expect(backRef.current).toBeTruthy();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("裏面に公開プロフィール URL の文字列を表示する", async () => {
    const frontRef = createRef<ViewInstance>();
    const backRef = createRef<ViewInstance>();

    await render(
      <MeishiPrintSnapshot
        document={doc}
        context={baseContext}
        frontRef={frontRef}
        backRef={backRef}
      />,
    );

    expect(screen.getByText("https://example.com/user/u1")).toBeTruthy();
  });

  it("profileUrl が無いときは裏面に URL 文字列を出さない", async () => {
    const frontRef = createRef<ViewInstance>();
    const backRef = createRef<ViewInstance>();

    await render(
      <MeishiPrintSnapshot
        document={doc}
        context={{ profile: {} }}
        frontRef={frontRef}
        backRef={backRef}
      />,
    );

    expect(screen.queryByText(/example\.com/)).toBeNull();
  });
});
