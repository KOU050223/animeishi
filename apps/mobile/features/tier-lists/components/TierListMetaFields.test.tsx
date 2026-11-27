import { render, screen } from "@testing-library/react-native";
import { TierListMetaFields } from "@/features/tier-lists/components/TierListMetaFields";

it("リンク共有中でひろば非公開なら、リンク保持者だけが見られると一文で示す", async () => {
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
  expect(
    screen.getByText(
      "リンク共有中です。ひろばには載らず、URL を知っている人だけが見られます",
    ),
  ).toBeTruthy();
  expect(screen.getByText("ひろばには表示されません")).toBeTruthy();
});

it("リンク共有中かつひろば公開中なら、両方の公開経路を示す", async () => {
  await render(
    <TierListMetaFields
      description=""
      onChangeDescription={() => {}}
      isPublic
      shareToken="token"
      onChangeIsPublic={() => {}}
      disabled={false}
      testIDPrefix="tier-list"
    />,
  );
  expect(
    screen.getByText(
      "リンク共有中です。ひろばへの掲載とは別に、URL を知っている人も見られます",
    ),
  ).toBeTruthy();
  expect(screen.getByText("公開中。ひろばの一覧に表示されます")).toBeTruthy();
});

it("リンク未発行ならひろば非公開と案内し、リンク共有の説明は出さない", async () => {
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
  expect(screen.queryByText(/リンク共有中/)).toBeNull();
});
