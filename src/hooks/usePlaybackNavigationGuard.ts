import { useEffect } from "react";

const PLAYBACK_NAVIGATION_CONFIRM_MESSAGE =
  "A deck is still playing. Leave this page and stop playback?";

const isModifiedClick = (event: MouseEvent) =>
  event.defaultPrevented ||
  event.button !== 0 ||
  event.metaKey ||
  event.ctrlKey ||
  event.shiftKey ||
  event.altKey;

const isPageNavigationLink = (anchor: HTMLAnchorElement) => {
  if (anchor.download) return false;
  if (anchor.target && anchor.target !== "_self") return false;
  const rawHref = anchor.getAttribute("href");
  if (!rawHref || rawHref.startsWith("#")) return false;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return true;
  return url.pathname !== window.location.pathname || url.search !== window.location.search;
};

const usePlaybackNavigationGuard = (hasActivePlayback: boolean) => {
  useEffect(() => {
    if (!hasActivePlayback) return undefined;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = PLAYBACK_NAVIGATION_CONFIRM_MESSAGE;
      return PLAYBACK_NAVIGATION_CONFIRM_MESSAGE;
    };

    const handleDocumentClick = (event: MouseEvent) => {
      if (isModifiedClick(event)) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (!isPageNavigationLink(anchor)) return;
      if (window.confirm(PLAYBACK_NAVIGATION_CONFIRM_MESSAGE)) return;
      event.preventDefault();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [hasActivePlayback]);
};

export { PLAYBACK_NAVIGATION_CONFIRM_MESSAGE };
export default usePlaybackNavigationGuard;
