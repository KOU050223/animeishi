import React from "react";
import { Linking } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { SocialLinksList } from "./SocialLinksList";
import type { SocialLink } from "@/lib/socialLinks";
import { socialLinkLabel } from "@/lib/socialLinks";

const links: SocialLink[] = [
  {
    kind: "x",
    value: "artist",
    visibility: "public",
    url: "https://x.com/artist",
  },
  {
    kind: "other",
    value: "https://example.com/shop",
    visibility: "friends",
    url: "https://example.com/shop",
  },
];

it("リンクをサービス名と値つきで表示する", async () => {
  await render(<SocialLinksList links={links} />);

  expect(screen.getByText("X · artist")).toBeTruthy();
  expect(screen.getByText("URL · https://example.com/shop")).toBeTruthy();
});

it("リンクがなければ何も表示しない", async () => {
  const { toJSON } = await render(<SocialLinksList links={[]} />);
  expect(toJSON()).toBeNull();
});

it("タップで外部 URL を開く", async () => {
  const openURL = jest
    .spyOn(Linking, "openURL")
    .mockResolvedValueOnce(undefined);
  await render(<SocialLinksList links={links} />);

  await fireEvent.press(screen.getByLabelText("X artist"));

  expect(openURL).toHaveBeenCalledWith("https://x.com/artist");
});

it("サービス名のラベルが種別ごとに定義される", () => {
  expect(socialLinkLabel("pixiv")).toBe("pixiv");
  expect(socialLinkLabel("fanbox")).toBe("FANBOX");
  expect(socialLinkLabel("dlsite")).toBe("DLsite");
  expect(socialLinkLabel("dmm")).toBe("DMM / FANZA");
  expect(socialLinkLabel("youtube")).toBe("YouTube");
});
