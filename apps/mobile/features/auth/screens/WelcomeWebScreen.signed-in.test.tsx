/**
 * @jest-environment <rootDir>/jest.jsdom-env.cjs
 */
import { createElement } from "react";
import { render } from "@testing-library/react-native";
import WelcomeScreen from "@/app/welcome.web";

jest.mock("@clerk/expo", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
}));

jest.mock("expo-router", () => {
  const React = require("react") as typeof import("react");
  const { Text } = require("react-native") as typeof import("react-native");
  return {
    Redirect: ({ href }: { href: string }) =>
      React.createElement(Text, { testID: "redirect-target" }, href),
    Stack: { Screen: () => null },
  };
});

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("WelcomeScreen signed-in redirect (web)", () => {
  it("returns an authenticated visitor to the existing root home", async () => {
    const view = await render(createElement(WelcomeScreen));

    expect(view.getByTestId("redirect-target").props.children).toBe("/");
  });
});
