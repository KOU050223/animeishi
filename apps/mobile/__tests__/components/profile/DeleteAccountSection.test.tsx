import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { DeleteAccountSection } from "@/components/profile/DeleteAccountSection";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("DeleteAccountSection", () => {
  it("削除ボタン押下で段階フロー（/delete-account）へ遷移する", async () => {
    await render(<DeleteAccountSection />);

    await fireEvent.press(screen.getByLabelText("アカウントを削除"));

    expect(mockPush).toHaveBeenCalledWith("/delete-account");
  });
});
