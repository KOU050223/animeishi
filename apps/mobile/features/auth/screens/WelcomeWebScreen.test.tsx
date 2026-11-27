/**
 * @jest-environment <rootDir>/jest.jsdom-env.cjs
 */
import { createElement } from "react";
import { fireEvent, render } from "@testing-library/react-native";
import WelcomeScreen from "@/app/welcome.web";

const mockUseAuth = jest.fn(() => ({ isLoaded: true, isSignedIn: false }));
const mockNavigate = jest.fn();

jest.mock("@clerk/expo", () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock("expo-router", () => {
  const React = require("react") as typeof import("react");
  const { Pressable, Text } =
    require("react-native") as typeof import("react-native");
  return {
    Link: ({
      children,
      href,
      testID,
    }: {
      children: React.ReactNode;
      href: string;
      testID?: string;
    }) => {
      const onPress = () => mockNavigate(href);
      if (typeof children === "string") {
        return React.createElement(Text, { testID, onPress }, children);
      }
      return React.createElement(Pressable, { testID, onPress }, children);
    },
    Redirect: ({ href }: { href: string }) =>
      React.createElement(Text, { testID: "redirect-target" }, href),
    Stack: { Screen: () => null },
  };
});

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock("react-native-qrcode-svg", () => {
  const React = require("react") as typeof import("react");
  const { View } = require("react-native") as typeof import("react-native");
  return () => React.createElement(View, { testID: "sample-qr-code" });
});

jest.mock("@/components/profile/MalAttribution", () => ({
  MalAttribution: () => null,
}));

describe("WelcomeScreen (web)", () => {
  it("renders sample scenes and routes guest calls to action to auth", async () => {
    mockUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: false });
    mockNavigate.mockClear();
    const view = await render(createElement(WelcomeScreen));

    expect(view.getByTestId("landing-page")).toBeTruthy();
    expect(view.getByText("星乃 みなと")).toBeTruthy();
    expect(view.getByText("イベントで、QRを見せて名刺交換")).toBeTruthy();
    expect(view.getByText("推しのTier表を、SNSでシェア")).toBeTruthy();
    expect(view.getByText("今期を振り返って、好きの傾向を発見")).toBeTruthy();
    expect(view.getByTestId("landing-sample-qr")).toBeTruthy();
    expect(view.getByTestId("landing-exchange-qr")).toBeTruthy();

    await fireEvent.press(view.getByTestId("landing-sign-in-top"));
    await fireEvent.press(view.getByTestId("landing-sign-up-hero"));
    await fireEvent.press(view.getByTestId("landing-sign-up-bottom"));

    expect(mockNavigate.mock.calls).toEqual([
      ["/(auth)/sign-in"],
      ["/(auth)/sign-up"],
      ["/(auth)/sign-up"],
    ]);
  });
});
