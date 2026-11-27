import React from "react";
import { act, render, screen } from "@testing-library/react-native";
import i18n from "@/lib/i18n";
import { TemplateStep } from "./TemplateStep";

jest.mock("@/features/meishi/components/MeishiRenderer", () => ({
  MeishiRenderer: () => null,
}));

jest.mock("./OnboardingScaffold", () => ({
  OnboardingScaffold: ({
    children,
    footer,
  }: {
    children: React.ReactNode;
    footer: React.ReactNode;
  }) => {
    const { createElement, Fragment } = jest.requireActual(
      "react",
    ) as typeof React;
    return createElement(Fragment, null, children, footer);
  },
}));

const baseProps = {
  stepIndex: 1,
  totalSteps: 4,
  selectedTemplateId: "classic",
  onSelect: jest.fn(),
  onNext: jest.fn(),
  saving: false,
  error: null,
  onSkip: jest.fn(),
};

describe("TemplateStep", () => {
  it("テンプレートごとの名前で読み上げ、選択状態を示す", async () => {
    await render(<TemplateStep {...baseProps} />);

    const selected = screen.getByLabelText("クラシックテンプレートを選ぶ");
    expect(selected.props.accessibilityState).toEqual({ selected: true });
    const unselected = screen.getByLabelText("白紙テンプレートを選ぶ");
    expect(unselected.props.accessibilityState).toEqual({ selected: false });
  });

  it("英語ではテンプレートの読み上げ名を翻訳する", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    try {
      await render(<TemplateStep {...baseProps} />);
      expect(screen.getByLabelText("Choose the Classic template")).toBeTruthy();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("ja");
      });
    }
  });
});
