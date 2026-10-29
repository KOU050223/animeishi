import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { FriendStoryViewer } from "@/components/FriendStoryViewer";
import type { FriendWatchStory } from "@/lib/useFriendWatchStories";

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

describe("FriendStoryViewer", () => {
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
