// TextEditSheet のテスト。
// 入力値のリセットは effect ではなくレンダー中の状態調整で行う（#267）。
// 「開くたびに初期値へ戻る」「開いたまま initialValue が変わっても追従する」
// 「同じ入力では再セットしない（再レンダー上限にならない）」を確かめる。
import { fireEvent, render, screen } from "@testing-library/react-native";
import { TextEditSheet } from "./TextEditSheet";

const sheetElement = (props?: {
  visible?: boolean;
  initialValue?: string;
  onClose?: () => void;
  onSubmit?: (value: string) => void;
}) => (
  <TextEditSheet
    visible={props?.visible ?? true}
    initialValue={props?.initialValue ?? "初期テキスト"}
    onClose={props?.onClose ?? jest.fn()}
    onSubmit={props?.onSubmit ?? jest.fn()}
  />
);

describe("TextEditSheet", () => {
  it("初期値を入力欄に表示する", () => {
    render(sheetElement({ initialValue: "こんにちは" }));
    expect(screen.getByDisplayValue("こんにちは")).toBeTruthy();
  });

  it("一度閉じて開き直すと入力値が初期値に戻る", () => {
    const { rerender } = render(sheetElement({ initialValue: "before" }));
    fireEvent.changeText(screen.getByDisplayValue("before"), "edited");
    expect(screen.getByDisplayValue("edited")).toBeTruthy();

    rerender(sheetElement({ visible: false, initialValue: "before" }));
    rerender(sheetElement({ visible: true, initialValue: "after" }));

    expect(screen.getByDisplayValue("after")).toBeTruthy();
  });

  it("開いたまま initialValue が変わると入力値が追従する", () => {
    const { rerender } = render(sheetElement({ initialValue: "first" }));
    fireEvent.changeText(screen.getByDisplayValue("first"), "edited");

    rerender(sheetElement({ initialValue: "second" }));

    expect(screen.getByDisplayValue("second")).toBeTruthy();
  });

  it("完了で入力値を onSubmit に渡して閉じる", () => {
    const onSubmit = jest.fn();
    const onClose = jest.fn();
    render(sheetElement({ onSubmit, onClose }));

    fireEvent.changeText(screen.getByDisplayValue("初期テキスト"), "新しい文");
    fireEvent.press(screen.getByLabelText("完了"));

    expect(onSubmit).toHaveBeenCalledWith("新しい文");
    expect(onClose).toHaveBeenCalled();
  });
});
