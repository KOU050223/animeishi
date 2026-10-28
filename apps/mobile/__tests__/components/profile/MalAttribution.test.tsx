import React from "react";
import { Linking } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { MalAttribution } from "@/components/profile/MalAttribution";

describe("MalAttribution", () => {
  it("MAL の帰属表示を表示する", async () => {
    await render(<MalAttribution />);

    expect(
      screen.getByText("作品画像の一部は MyAnimeList から取得しています"),
    ).toBeTruthy();
  });

  it("リンクを押すと MyAnimeList を開く", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await render(<MalAttribution />);

    await fireEvent.press(screen.getByLabelText("MyAnimeList を開く"));

    expect(openURL).toHaveBeenCalledWith("https://myanimelist.net/");
  });
});
