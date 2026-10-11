import React from "react";
import { render, screen } from "@testing-library/react-native";
import { AppVersionFooter } from "@/components/AppVersionFooter";
import type { AppInfo } from "@/lib/appInfo";

const mockGetAppInfo = jest.fn<AppInfo, []>();
const mockUseApiVersion = jest.fn();

jest.mock("@/lib/appInfo", () => ({
  getAppInfo: () => mockGetAppInfo(),
}));

jest.mock("@/lib/useApiVersion", () => ({
  useApiVersion: () => mockUseApiVersion(),
}));

const baseAppInfo: AppInfo = {
  appVersion: "1.0.0",
  buildVersion: "42",
  updateId: "update-id-1",
  commitSha: "abc1234deadbeef",
  environment: "production",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAppInfo.mockReturnValue(baseAppInfo);
  mockUseApiVersion.mockReturnValue({
    data: {
      status: "ok",
      timestamp: "2026-01-01T00:00:00.000Z",
      environment: "production",
      commitSha: "def5678deadbeef",
      versionId: "version-1",
    },
  });
});

describe("AppVersionFooter", () => {
  it("アプリバージョン・環境・更新 ID・コミット・API バージョンを表示する", () => {
    render(<AppVersionFooter />);

    expect(screen.getByText("アプリバージョン: 1.0.0 (42)")).toBeTruthy();
    expect(screen.getByText("環境: production")).toBeTruthy();
    expect(screen.getByText("更新 ID: update-id-1")).toBeTruthy();
    // コミット SHA は短縮表示
    expect(screen.getByText("コミット: abc1234")).toBeTruthy();
    expect(screen.getByText("API: def5678 (production)")).toBeTruthy();
  });

  it("取得できない項目は行ごと表示しない", () => {
    mockGetAppInfo.mockReturnValue({ appVersion: "1.0.0" });
    mockUseApiVersion.mockReturnValue({ data: undefined });

    render(<AppVersionFooter />);

    expect(screen.getByText("アプリバージョン: 1.0.0")).toBeTruthy();
    expect(screen.queryByText(/^環境:/)).toBeNull();
    expect(screen.queryByText(/^更新 ID:/)).toBeNull();
    expect(screen.queryByText(/^コミット:/)).toBeNull();
    expect(screen.queryByText(/^API:/)).toBeNull();
  });

  it("API がコミット SHA を持たない場合は versionId に倒す", () => {
    mockUseApiVersion.mockReturnValue({
      data: {
        status: "ok",
        timestamp: "2026-01-01T00:00:00.000Z",
        environment: null,
        commitSha: null,
        versionId: "01234567-89ab-cdef",
      },
    });

    render(<AppVersionFooter />);

    expect(screen.getByText("API: 0123456")).toBeTruthy();
  });

  it("コミット SHA と versionId が共にない場合は API 行を出さない", () => {
    mockUseApiVersion.mockReturnValue({
      data: {
        status: "ok",
        timestamp: "2026-01-01T00:00:00.000Z",
        environment: null,
        commitSha: null,
        versionId: null,
      },
    });

    render(<AppVersionFooter />);

    expect(screen.queryByText(/^API:/)).toBeNull();
  });

  it("取得失敗時は成功済みデータより「取得失敗」を優先して表示する", () => {
    // React Query はリフェッチ失敗時に直前の data を保持する。
    // isError のときはその古い値ではなく失敗表示に切り替える。
    mockUseApiVersion.mockReturnValue({
      isError: true,
      data: {
        status: "ok",
        timestamp: "2026-01-01T00:00:00.000Z",
        environment: "production",
        commitSha: "def5678deadbeef",
        versionId: "version-1",
      },
    });

    render(<AppVersionFooter />);

    expect(screen.getByText("API: 取得失敗")).toBeTruthy();
    expect(screen.queryByText(/def5678/)).toBeNull();
  });
});
