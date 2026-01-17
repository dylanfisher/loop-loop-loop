import { useMemo } from "react";
import { getAudioEngine } from "../audio/engine";

const useAudioEngine = () => {
  return useMemo(() => getAudioEngine(), []);
};

export default useAudioEngine;
