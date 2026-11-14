import { render, screen } from "@testing-library/react-native";
import { TierListMetaFields } from "@/components/tier-list/TierListMetaFields";

it("リンク共有中でひろば非公開の Tier 表を両方の状態で示す", async () => {
  await render(
    <TierListMetaFields
      description=""
      onChangeDescription={() => {}}
      isPublic={false}
      shareToken="token"
      onChangeIsPublic={() => {}}
      disabled={false}
      testIDPrefix="tier-list"
    />,
  );
  expect(screen.getByText("リンク共有中")).toBeTruthy();
  expect(
    screen.getByText("ひろばには表示されません。共有リンクからは閲覧できます"),
  ).toBeTruthy();
});

it("リンク未発行ならひろば非公開と案内する", async () => {
  await render(
    <TierListMetaFields
      description=""
      onChangeDescription={() => {}}
      isPublic={false}
      shareToken={null}
      onChangeIsPublic={() => {}}
      disabled={false}
      testIDPrefix="tier-list"
    />,
  );
  expect(screen.getByText("ひろばには表示されません")).toBeTruthy();
  expect(screen.queryByText("リンク共有中")).toBeNull();
});
