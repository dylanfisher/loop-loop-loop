import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import usePlaybackNavigationGuard from "../usePlaybackNavigationGuard";

describe("usePlaybackNavigationGuard", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("blocks browser unload while playback is active", () => {
    renderHook(() => usePlaybackNavigationGuard(true));
    const event = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("does not block browser unload while playback is inactive", () => {
    renderHook(() => usePlaybackNavigationGuard(false));
    const event = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("confirms same-tab link navigation while playback is active", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const link = document.createElement("a");
    link.href = "/next";
    document.body.appendChild(link);
    renderHook(() => usePlaybackNavigationGuard(true));

    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(event);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("allows download links without prompting", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const link = document.createElement("a");
    link.href = "/export.wav";
    link.download = "export.wav";
    link.addEventListener("click", (event) => event.preventDefault());
    document.body.appendChild(link);
    renderHook(() => usePlaybackNavigationGuard(true));

    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(event);

    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
