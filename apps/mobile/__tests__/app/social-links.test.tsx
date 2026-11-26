import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import SocialLinksScreen from "@/app/social-links";

const mockUseSocialLinks = jest.fn();
const mockUseSaveSocialLinks = jest.fn();

jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back: jest.fn() }),
}));

jest.mock("@/lib/socialLinks", () => ({
  ...jest.requireActual("@/lib/socialLinks"),
  useSocialLinks: () => mockUseSocialLinks(),
  useSaveSocialLinks: () => mockUseSaveSocialLinks(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUseSocialLinks.mockReturnValue({
    data: {
      items: [
        {
          kind: "x",
          value: "",
          visibility: "friends",
        },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
  mockUseSaveSocialLinks.mockReturnValue({
    mutateAsync: jest.fn(),
    isPending: false,
  });
});

describe("SocialLinksScreen", () => {
  it("選択中の種別ボタンを押しても入力済みの値が消えない", async () => {
    await render(<SocialLinksScreen />);

    await fireEvent.changeText(screen.getByLabelText("ユーザー ID"), "alice");
    await fireEvent.press(screen.getByText("X"));

    expect(screen.getByLabelText("ユーザー ID").props.value).toBe("alice");
  });

  it("別の種別へ切り替えると入力済みの値が消える", async () => {
    await render(<SocialLinksScreen />);

    await fireEvent.changeText(screen.getByLabelText("ユーザー ID"), "alice");
    await fireEvent.press(screen.getByText("URL"));

    expect(screen.getByLabelText("URL").props.value).toBe("");
  });
});
