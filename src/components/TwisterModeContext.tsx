import { createContext, useContext } from "react";
import type { MidiActionId } from "../types/midi";

type TwisterModeContextValue = {
  enabled: boolean;
  actionToSlotIndex: Partial<Record<MidiActionId, number>>;
  slotColors: string[];
};

const TwisterModeContext = createContext<TwisterModeContextValue | null>(null);

export const TwisterModeProvider = TwisterModeContext.Provider;

export const useTwisterModeContext = () => useContext(TwisterModeContext);

