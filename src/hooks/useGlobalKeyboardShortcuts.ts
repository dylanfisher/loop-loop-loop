import { useEffect } from "react";
import { isTextInputTarget } from "../utils/appHelpers";

type UseGlobalKeyboardShortcutsArgs = {
  addDeck: () => void;
  undo: () => void;
  redo: () => void;
  handleSaveSession: () => Promise<void>;
  handleLoadSession: () => Promise<void>;
  handleGlobalPlaybackToggle: () => void;
  handleFocusedDeckPlaybackToggle: () => void;
  handleFocusedDeckFxVisibilityToggle: () => void;
  handleAllDecksFxVisibilityToggle: () => void;
  handleFocusedDeckLoopReset: () => void;
  handleFocusedDeckRemove: () => void;
  handleFocusedDeckRearrangerPanelToggle: () => void;
  handleFocusedDeckLoopToggle: () => void;
  handleFocusedDeckZoom: (direction: "in" | "out") => void;
  handleFocusedDeckCrop: () => void;
  handleFocusedDeckDuplicate: () => void;
  onToggleSessionPanel: () => void;
  setShowKeyboardShortcuts: React.Dispatch<React.SetStateAction<boolean>>;
};

const useGlobalKeyboardShortcuts = ({
  addDeck,
  undo,
  redo,
  handleSaveSession,
  handleLoadSession,
  handleGlobalPlaybackToggle,
  handleFocusedDeckPlaybackToggle,
  handleFocusedDeckFxVisibilityToggle,
  handleAllDecksFxVisibilityToggle,
  handleFocusedDeckLoopReset,
  handleFocusedDeckRemove,
  handleFocusedDeckRearrangerPanelToggle,
  handleFocusedDeckLoopToggle,
  handleFocusedDeckZoom,
  handleFocusedDeckCrop,
  handleFocusedDeckDuplicate,
  onToggleSessionPanel,
  setShowKeyboardShortcuts,
}: UseGlobalKeyboardShortcutsArgs) => {
  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const key = event.key;
      const lower = key.toLowerCase();
      const hasPrimaryModifier = event.metaKey || event.ctrlKey;

      if (hasPrimaryModifier) {
        if (lower === "z") {
          event.preventDefault();
          if (event.shiftKey) {
            redo();
          } else {
            undo();
          }
          return;
        }
        if (lower === "s") {
          event.preventDefault();
          void handleSaveSession();
          return;
        }
        if (lower === "o") {
          event.preventDefault();
          void handleLoadSession();
        }
        return;
      }

      if (isTextInputTarget(event.target)) return;

      if (key === "?" && !event.altKey) {
        event.preventDefault();
        setShowKeyboardShortcuts((prev) => !prev);
        return;
      }

      if (event.altKey) return;

      if (key === " " || event.code === "Space") {
        event.preventDefault();
        if (event.shiftKey) {
          handleGlobalPlaybackToggle();
        } else {
          handleFocusedDeckPlaybackToggle();
        }
        return;
      }

      if (event.shiftKey) {
        if (lower === "q") {
          event.preventDefault();
          handleAllDecksFxVisibilityToggle();
          return;
        }
        if (lower === "l") {
          event.preventDefault();
          handleFocusedDeckLoopReset();
        }
        return;
      }

      if (key === "Delete" || key === "Backspace") {
        event.preventDefault();
        handleFocusedDeckRemove();
        return;
      }

      if (lower === "r") {
        event.preventDefault();
        handleFocusedDeckRearrangerPanelToggle();
        return;
      }
      if (lower === "q") {
        event.preventDefault();
        handleFocusedDeckFxVisibilityToggle();
        return;
      }
      if (lower === "l") {
        event.preventDefault();
        handleFocusedDeckLoopToggle();
        return;
      }
      if (key === "=") {
        event.preventDefault();
        handleFocusedDeckZoom("out");
        return;
      }
      if (key === "-") {
        event.preventDefault();
        handleFocusedDeckZoom("in");
        return;
      }
      if (lower === "c") {
        event.preventDefault();
        handleFocusedDeckCrop();
        return;
      }
      if (lower === "d") {
        event.preventDefault();
        handleFocusedDeckDuplicate();
        return;
      }
      if (lower === "e") {
        event.preventDefault();
        onToggleSessionPanel();
        return;
      }
      if (lower === "a") {
        event.preventDefault();
        addDeck();
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [
    addDeck,
    handleGlobalPlaybackToggle,
    handleFocusedDeckLoopReset,
    handleFocusedDeckLoopToggle,
    handleFocusedDeckCrop,
    handleFocusedDeckDuplicate,
    onToggleSessionPanel,
    handleFocusedDeckRemove,
    handleFocusedDeckPlaybackToggle,
    handleFocusedDeckFxVisibilityToggle,
    handleAllDecksFxVisibilityToggle,
    handleFocusedDeckRearrangerPanelToggle,
    handleFocusedDeckZoom,
    handleLoadSession,
    handleSaveSession,
    redo,
    setShowKeyboardShortcuts,
    undo,
  ]);
};

export default useGlobalKeyboardShortcuts;
