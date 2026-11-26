import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { FriendStoryViewer } from "@/components/FriendStoryViewer";
import type { FriendWatchStory } from "@/features/feed/useFriendWatchStories";
import { WorkDetailContext } from "@/lib/workDetailContext";

function friend(items: FriendWatchStory["items"]): FriendWatchStory {
  return {
    actor: { userId: "u1", username: "たろう", profileImageUrl: null },
    items,
  };
}

function item(
  id: number,
  title: string,
  state = "WATCHED",
): FriendWatchStory["items"][number] {
  return {
    id,
    createdAt: new Date().toISOString(),
    work: {
      annictWorkId: id,
      title,
      titleEn: null,
      hostedImageUrl: null,
    },
    meta: { state },
  };
}

function itemWithImage(
  id: number,
  title: string,
): FriendWatchStory["items"][number] {
  const base = item(id, title);
  return {
    ...base,
    work: {
      annictWorkId: id,
      title,
      titleEn: null,
      hostedImageUrl: "https://example.com/poster.jpg",
    },
  };
}

describe("FriendStoryViewer", () => {
  beforeEach(() => {
    // スライドの自動送りは RN Animated の rAF タイマーで進む。実タイマーのままだと
    // テストの act 境界の外で Animated.View が再描画されるため、明示的に進める。
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("作品を選ぶとビューアを閉じて詳細を開く", async () => {
    const openWork = jest.fn();
    const onClose = jest.fn();
    await render(
      <WorkDetailContext.Provider value={openWork}>
        <FriendStoryViewer
          friend={friend([item(1, "作品A")])}
          onClose={onClose}
        />
      </WorkDetailContext.Provider>,
    );
    await fireEvent.press(screen.getByTestId("story-work-detail"));
    // iOS でモーダル退場中に次のモーダルを出すと表示が競合するため、
    // 退場の完了（onDismiss / 代替タイマー）までは何も呼ばれない。
    expect(onClose).not.toHaveBeenCalled();
    expect(openWork).not.toHaveBeenCalled();
    // テスト環境（= Android と同じく onDismiss が来ない）ではタイマーで開く。
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(openWork).toHaveBeenCalledWith(
      expect.objectContaining({ annictWorkId: 1, title: "作品A" }),
    );
  });
  it("最初のスライドとして作品名と視聴状態を表示する", async () => {
    await render(
      <FriendStoryViewer
        friend={friend([item(1, "作品A", "WATCHED")])}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByTestId("story-work-title")).toHaveTextContent("作品A");
    expect(screen.getByText("視聴済にしました")).toBeTruthy();
  });

  it("右側タップで次のスライド、左側タップで前のスライドに進む", async () => {
    await render(
      <FriendStoryViewer
        friend={friend([item(1, "作品A"), item(2, "作品B")])}
        onClose={jest.fn()}
      />,
    );

    await fireEvent.press(screen.getByTestId("story-next"));
    expect(screen.getByTestId("story-work-title")).toHaveTextContent("作品B");

    await fireEvent.press(screen.getByTestId("story-prev"));
    expect(screen.getByTestId("story-work-title")).toHaveTextContent("作品A");
  });

  it("最後のスライドで次へを押すとビューアを閉じる", async () => {
    const onClose = jest.fn();
    await render(
      <FriendStoryViewer
        friend={friend([item(1, "作品A"), item(2, "作品B")])}
        onClose={onClose}
      />,
    );

    await fireEvent.press(screen.getByTestId("story-next"));
    await fireEvent.press(screen.getByTestId("story-next"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("閉じるボタンでビューアを閉じる", async () => {
    const onClose = jest.fn();
    await render(
      <FriendStoryViewer
        friend={friend([item(1, "作品A")])}
        onClose={onClose}
      />,
    );

    await fireEvent.press(screen.getByTestId("story-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ポスター画像は cover で切り抜かず contain で全体を表示する", async () => {
    await render(
      <FriendStoryViewer
        friend={friend([itemWithImage(1, "作品A")])}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByTestId("story-work-image")).toHaveProp(
      "resizeMode",
      "contain",
    );
  });

  it("先頭のスライドで前へを押しても先頭のままになる", async () => {
    const onClose = jest.fn();
    await render(
      <FriendStoryViewer
        friend={friend([item(1, "作品A"), item(2, "作品B")])}
        onClose={onClose}
      />,
    );

    await fireEvent.press(screen.getByTestId("story-prev"));

    expect(screen.getByTestId("story-work-title")).toHaveTextContent("作品A");
    expect(onClose).not.toHaveBeenCalled();
  });
});
