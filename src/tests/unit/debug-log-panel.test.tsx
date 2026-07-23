// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import { DebugLogPanel } from "../../components/debug/DebugLogPanel";
import {
  appendDebugLog,
  clearDebugLogs
} from "../../services/debug-log-service";

describe("frontend debug log panel", () => {
  beforeEach(() => {
    clearDebugLogs();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens from the global entry and exposes recorded errors", () => {
    appendDebugLog({
      level: "error",
      category: "network",
      message: "POST /api/single-image-viewpoint 网络请求失败",
      details: {
        online: true,
        error: {
          name: "TypeError",
          message: "Failed to fetch"
        }
      }
    });

    render(<DebugLogPanel />);

    expect(
      screen.getByLabelText("1 条错误日志")
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "打开 Debug 日志" })
    );

    expect(
      screen.getByRole("dialog", { name: "前端 Debug 日志" })
    ).toBeTruthy();
    expect(
      screen.getByText("POST /api/single-image-viewpoint 网络请求失败")
    ).toBeTruthy();
  });

  it("runs the backend connection check and appends the result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              status: "ok",
              service: "api2image-bff"
            }
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json"
            }
          }
        )
      )
    );

    render(<DebugLogPanel />);
    fireEvent.click(
      screen.getByRole("button", { name: "打开 Debug 日志" })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "连接自检" })
    );

    await waitFor(() => {
      expect(
        screen.getByText("前端连接自检通过")
      ).toBeTruthy();
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({
        cache: "no-store"
      })
    );
  });
});
