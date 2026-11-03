import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import {
  NOW_WATCHING_TTL_MS,
  NowWatchingBubble,
} from "@/components/NowWatchingBubble";
import type { NowWatching } from "@/lib/publicProfile";

jest.mock("@/lib/useWorkEpisodes", () => ({
  useWorkEpisodes: () => ({ data: undefined }),
}));

const NOW_WATCHING: NowWatching = {
  annictWorkId: 3002,
  annictEpisodeId: 502,
  title: "新作アニメ",
  titleEn: null,
  seasonName: "2026-autumn",
  seasonYear: 2026,
  hostedImageUrl: null,
  recordedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
};

afterEach(() => {
  jest.useRealTimers();
});

describe("NowWatchingBubble の表示期限", () => {
  it("期限内の記録なら吹き出しを表示する", async () => {
    await render(
      <NowWatchingBubble
        nowWatching={NOW_WATCHING}
        onPress={jest.fn()}
        testID="now-watching-bubble"
      />,
    );

    expect(screen.getByTestId("now-watching-bubble")).toBeTruthy();
    expect(screen.getByText("新作アニメ")).toBeTruthy();
  });

  it("期限切れの記録なら吹き出しを出さない", async () => {
    await render(
      <NowWatchingBubble
        nowWatching={{
          ...NOW_WATCHING,
          recordedAt: new Date(
            Date.now() - NOW_WATCHING_TTL_MS - 60 * 1000,
          ).toISOString(),
        }}
        onPress={jest.fn()}
        testID="now-watching-bubble"
      />,
    );

    // 期限切れの判定はタイマーコールバックで行うため、非表示になるまで待つ
    await waitFor(() =>
      expect(screen.queryByTestId("now-watching-bubble")).toBeNull(),
    );
  });

  it("表示中に期限を迎えると吹き出しが消える", async () => {
    jest.useFakeTimers();
    const recordedAt = new Date(
      Date.now() - NOW_WATCHING_TTL_MS + 1000,
    ).toISOString();
    await render(
      <NowWatchingBubble
        nowWatching={{ ...NOW_WATCHING, recordedAt }}
        onPress={jest.fn()}
        testID="now-watching-bubble"
      />,
    );

    expect(screen.getByTestId("now-watching-bubble")).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.queryByTestId("now-watching-bubble")).toBeNull();
  });
});
