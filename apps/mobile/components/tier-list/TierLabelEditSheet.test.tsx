import { fireEvent, render } from "@testing-library/react-native";
import { TierLabelEditSheet } from "./TierLabelEditSheet";

const renderSheet = (props?: {
  initialValue?: string;
  onClose?: () => void;
  onSubmit?: (value: string) => void;
}) =>
  render(
    <TierLabelEditSheet
      visible
      initialValue={props?.initialValue ?? "S"}
      onClose={props?.onClose ?? jest.fn()}
      onSubmit={props?.onSubmit ?? jest.fn()}
    />,
  );

describe("TierLabelEditSheet", () => {
  it("初期値を入力欄に表示する", () => {
    const { getByTestId } = renderSheet({ initialValue: "神" });
    expect(getByTestId("tier-label-input").props.value).toBe("神");
  });

  it("完了で入力値を onSubmit に渡して閉じる", () => {
    const onSubmit = jest.fn();
    const onClose = jest.fn();
    const { getByTestId } = renderSheet({ onSubmit, onClose });

    fireEvent.changeText(getByTestId("tier-label-input"), "最強");
    fireEvent.press(getByTestId("tier-label-submit"));

    expect(onSubmit).toHaveBeenCalledWith("最強");
    expect(onClose).toHaveBeenCalled();
  });

  it("空文字ではエラーを出して確定できない", () => {
    const onSubmit = jest.fn();
    const { getByTestId } = renderSheet({ onSubmit });

    fireEvent.changeText(getByTestId("tier-label-input"), "   ");

    expect(getByTestId("tier-label-error")).toBeTruthy();
    fireEvent.press(getByTestId("tier-label-submit"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("24 文字を超える入力はエラーになる", () => {
    const onSubmit = jest.fn();
    const { getByTestId } = renderSheet({ onSubmit });

    fireEvent.changeText(getByTestId("tier-label-input"), "あ".repeat(25));

    expect(getByTestId("tier-label-error")).toBeTruthy();
    fireEvent.press(getByTestId("tier-label-submit"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("キャンセルは onSubmit を呼ばずに閉じる", () => {
    const onSubmit = jest.fn();
    const onClose = jest.fn();
    const { getByLabelText } = renderSheet({ onSubmit, onClose });

    fireEvent.press(getByLabelText("キャンセル"));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
