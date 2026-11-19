import React from "react";
import { render, screen } from "@testing-library/react-native";
import { ListLoadingSkeleton } from "./ListLoadingSkeleton";

describe("ListLoadingSkeleton", () => {
  it("呼び出し側が渡した読み上げ文言を使う", async () => {
    await render(
      <ListLoadingSkeleton accessibilityLabel="視聴履歴を読み込み中" />,
    );

    expect(screen.getByLabelText("視聴履歴を読み込み中")).toBeTruthy();
  });
});
