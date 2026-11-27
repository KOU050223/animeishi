import React from "react";
import { render, screen } from "@testing-library/react-native";
import { FavoriteWorksStep } from "./FavoriteWorksStep";

jest.mock("@/features/works/useWorkCandidates", () => ({
  useWorkCandidates: () => ({
    isLoading: false,
    data: {
      works: [
        {
          annictWorkId: 1,
          nodeId: "node-1",
          state: null,
          title: "日本語タイトル",
          titleKana: null,
          titleEn: "English Title",
          seasonName: null,
          seasonYear: null,
          imageUrl: null,
          malAnimeId: null,
          watchersCount: 10,
          resolvedImageUrl: null,
          hostedImageUrl: null,
          genres: null,
        },
      ],
    },
  }),
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

describe("FavoriteWorksStep", () => {
  it("英語タイトルが日本語と異なる候補は両方のタイトルを読み上げ名に含める", async () => {
    await render(
      <FavoriteWorksStep
        stepIndex={0}
        totalSteps={4}
        selected={[]}
        onToggle={jest.fn()}
        onNext={jest.fn()}
        saving={false}
        error={null}
        onSkip={jest.fn()}
      />,
    );

    expect(
      screen.getByLabelText("日本語タイトル / English Title"),
    ).toBeTruthy();
  });
});
