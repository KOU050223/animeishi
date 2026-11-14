// Web 版 AddElementSheet（issue #528）。
// Modal + 全画面スクリムだと画面全体を覆い、名刺エディタのヘッダー
// （戻るボタン）まで押せなくなるため、Web 版は Modal を使わず親
// （editorBody）内に収まるオーバーレイとして描画する。ここでは
// 「Modal を使わない」「スクリム・閉じるボタンで閉じられる」ことを確かめる。
import { fireEvent, render, screen } from "@testing-library/react-native";
// jest は iOS 解決のため "./AddElementSheet" ではネイティブ版を読む。
// Web 版を直接 import して検証する。
import { AddElementSheet } from "./AddElementSheet.web";

const renderSheet = (props?: {
  visible?: boolean;
  onClose?: () => void;
  onPick?: (type: string) => void;
}) =>
  render(
    <AddElementSheet
      visible={props?.visible ?? true}
      onClose={props?.onClose ?? jest.fn()}
      onPick={props?.onPick ?? jest.fn()}
      onPickAvatarImage={jest.fn()}
      onPickAnimeImage={jest.fn()}
    />,
  );

describe("AddElementSheet (Web)", () => {
  it("visible でないときは何も描画しない", async () => {
    await renderSheet({ visible: false });
    expect(screen.queryByText("要素を追加")).toBeNull();
  });

  it("visible のとき項目を表示し、選択すると onPick に種別を渡す", async () => {
    const onPick = jest.fn();
    await renderSheet({ onPick });

    await fireEvent.press(screen.getByLabelText("テキストを追加"));

    expect(onPick).toHaveBeenCalledWith("text");
  });

  it("背景スクリムを押すと onClose を呼ぶ", async () => {
    const onClose = jest.fn();
    await renderSheet({ onClose });

    await fireEvent.press(screen.getByLabelText("要素の追加をやめる"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("閉じるボタンを押すと onClose を呼ぶ", async () => {
    const onClose = jest.fn();
    await renderSheet({ onClose });

    await fireEvent.press(screen.getByLabelText("閉じる"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Modal を使わず親内オーバーレイとして描画する（画面上部を覆わない）", async () => {
    const { toJSON } = await renderSheet();
    expect(JSON.stringify(toJSON())).not.toContain('"Modal"');
  });
});
