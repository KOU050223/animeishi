import React from "react";
import { render, screen } from "@testing-library/react-native";
import {
  WorkDetailInfoSkeleton,
  WorkDetailSkeleton,
} from "./WorkDetailSkeleton";

describe("WorkDetailSkeleton", () => {
  it("作品ページ全体を 1 つの busy な読み込み領域として出す", async () => {
    await render(<WorkDetailSkeleton />);

    // ヘッダー部と詳細行をまとめて 1 回だけ読み上げる
    expect(screen.getAllByLabelText("作品を読み込んでいます")).toHaveLength(1);
    const skeleton = screen.getByTestId("work-detail-skeleton");
    expect(skeleton.props.accessible).toBe(true);
    expect(skeleton.props.accessibilityState?.busy).toBe(true);
  });
});

describe("WorkDetailInfoSkeleton", () => {
  it("詳細情報部分を 1 つの busy な読み込み領域として出す", async () => {
    await render(<WorkDetailInfoSkeleton />);

    expect(screen.getAllByLabelText("読み込み中")).toHaveLength(1);
    const skeleton = screen.getByTestId("work-detail-info-skeleton");
    expect(skeleton.props.accessibilityState?.busy).toBe(true);
  });
});
