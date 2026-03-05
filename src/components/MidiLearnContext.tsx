import { createContext, useContext } from "react";
import type { MidiActionId } from "../types/midi";

type MidiLearnContextValue = {
  learnModeEnabled: boolean;
  armedActionId: MidiActionId | null;
  onArmAction: (actionId: MidiActionId) => void;
};

const MidiLearnContext = createContext<MidiLearnContextValue | null>(null);

export const MidiLearnProvider = MidiLearnContext.Provider;

export const useMidiLearnContext = () => useContext(MidiLearnContext);

