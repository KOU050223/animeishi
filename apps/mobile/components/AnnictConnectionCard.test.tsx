import React from "react";
import { render, screen } from "@testing-library/react-native";
import { AnnictConnectionCard } from "./AnnictConnectionCard";

let mockIsConnected = true;

jest.mock("@/lib/annict", () => ({
  useAnnictConnection: () => ({
    isConnected: mockIsConnected,
    isLoading: false,
  }),
  useAnnictConnect: () => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    isConnecting: false,
  }),
  useAnnictFunnel: () => jest.fn(),
}));

beforeEach(() => {
  mockIsConnected = true;
});

it("連携中は解除前に視聴履歴への影響と Annict の記録が残ることを伝える", async () => {
  await render(<AnnictConnectionCard surface="profile_card" />);

  expect(
    screen.getByText(
      "連携を解除すると、アニ名刺で Annict の視聴履歴を表示できなくなります。Annict 側の記録は削除されません。",
    ),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "連携を解除する" })).toBeTruthy();
});

it("未連携では解除の説明を表示しない", async () => {
  mockIsConnected = false;
  await render(<AnnictConnectionCard surface="profile_card" />);

  expect(
    screen.queryByText(
      "連携を解除すると、アニ名刺で Annict の視聴履歴を表示できなくなります。Annict 側の記録は削除されません。",
    ),
  ).toBeNull();
});
