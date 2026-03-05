import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TWISTER_PROFILE_PAGES,
  type MidiActionId,
  type MidiBinding,
  type MidiLearnMode,
  type MidiMappedValue,
} from "../types/midi";

type MidiPortState = "connected" | "disconnected";

type MidiNavigator = Navigator & {
  requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<MIDIAccess>;
};

const STORAGE_KEY = "midiMappings.v1";
const INPUT_KEY = "midiSelectedInput.v1";
const OUTPUT_KEY = "midiSelectedOutput.v1";
const SESSION_CONNECTED_KEY = "midiConnectedThisSession.v1";
const MIDI_DEBUG_LOGGING = true;

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);
const debugMidi = (...args: unknown[]) => {
  if (!MIDI_DEBUG_LOGGING) return;
  // Use console.log so output is visible even when "Verbose/Debug" levels are hidden.
  console.log("[midi]", ...args);
};

const decodeRelativeDelta = (value: number) => {
  // Support common relative encoder delta encodings:
  // - Sign/magnitude (1..63 = +, 65..127 = -)
  // - Two's complement (1..63 = +, 127..65 = -)
  // 0 and 64 are typically "no movement".
  if (value === 0 || value === 64) return 0;
  if (value >= 1 && value <= 63) return value;
  if (value >= 65 && value <= 127) return value - 128;
  return 0;
};

const parseBindings = (raw: string | null): MidiBinding[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is MidiBinding => {
      if (typeof entry !== "object" || entry === null) return false;
      const candidate = entry as MidiBinding;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.inputId === "string" &&
        typeof candidate.inputName === "string" &&
        (candidate.messageType === "cc" || candidate.messageType === "note") &&
        Number.isInteger(candidate.channel) &&
        Number.isInteger(candidate.number) &&
        typeof candidate.actionId === "string" &&
        (candidate.mode === "absolute" || candidate.mode === "relative")
      );
    });
  } catch {
    return [];
  }
};

type UseMidiControllerArgs = {
  onMappedValue: (event: MidiMappedValue) => void;
};

type MidiInputSummary = {
  id: string;
  name: string;
  state: MidiPortState;
};

type MidiOutputSummary = {
  id: string;
  name: string;
  state: MidiPortState;
};

type MidiLearnTarget = {
  actionId: MidiActionId;
  mode: MidiLearnMode;
};

const useMidiController = ({ onMappedValue }: UseMidiControllerArgs) => {
  const [supported] = useState(() =>
    typeof navigator !== "undefined" &&
    typeof (navigator as MidiNavigator).requestMIDIAccess === "function"
  );
  const [accessGranted, setAccessGranted] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [inputs, setInputs] = useState<MidiInputSummary[]>([]);
  const [outputs, setOutputs] = useState<MidiOutputSummary[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string | null>(() =>
    localStorage.getItem(INPUT_KEY)
  );
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(() =>
    localStorage.getItem(OUTPUT_KEY)
  );
  const [mappings, setMappings] = useState<MidiBinding[]>(() =>
    parseBindings(localStorage.getItem(STORAGE_KEY))
  );
  const [learnTarget, setLearnTarget] = useState<MidiLearnTarget | null>(null);

  const midiAccessRef = useRef<MIDIAccess | null>(null);
  const autoConnectAttemptedRef = useRef(false);
  const mappedValueRef = useRef(onMappedValue);
  const lastSentRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!MIDI_DEBUG_LOGGING) return;
    debugMidi("debug.enabled", {
      selectedInputId,
      selectedOutputId,
      inputCount: inputs.length,
      outputCount: outputs.length,
    });
  }, [inputs.length, outputs.length, selectedInputId, selectedOutputId]);

  useEffect(() => {
    mappedValueRef.current = onMappedValue;
  }, [onMappedValue]);

  const refreshPorts = useCallback(() => {
    const access = midiAccessRef.current;
    if (!access) {
      setInputs([]);
      setOutputs([]);
      return;
    }
    const nextInputs = Array.from(access.inputs.values()).map((port) => ({
      id: port.id,
      name: port.name ?? "Unnamed MIDI Input",
      state: port.state,
    }));
    const nextOutputs = Array.from(access.outputs.values()).map((port) => ({
      id: port.id,
      name: port.name ?? "Unnamed MIDI Output",
      state: port.state,
    }));
    setInputs(nextInputs);
    setOutputs(nextOutputs);
    if (selectedInputId && !nextInputs.some((input) => input.id === selectedInputId)) {
      setSelectedInputId(nextInputs[0]?.id ?? null);
    }
    if (selectedOutputId && !nextOutputs.some((output) => output.id === selectedOutputId)) {
      setSelectedOutputId(nextOutputs[0]?.id ?? null);
    }
  }, [selectedInputId, selectedOutputId]);

  const requestAccess = useCallback(async () => {
    if (!supported) return;
    try {
      const access = await (navigator as MidiNavigator).requestMIDIAccess?.({
        sysex: false,
      });
      if (!access) {
        setAccessError("Web MIDI did not return an access object.");
        return;
      }
      midiAccessRef.current = access;
      access.onstatechange = () => {
        refreshPorts();
      };
      setAccessGranted(true);
      setAccessError(null);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(SESSION_CONNECTED_KEY, "1");
      }
      refreshPorts();
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : "Failed to access MIDI devices.");
    }
  }, [refreshPorts, supported]);

  useEffect(() => {
    if (!supported || accessGranted || autoConnectAttemptedRef.current) return;
    autoConnectAttemptedRef.current = true;
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(SESSION_CONNECTED_KEY) !== "1") return;
    const timeoutId = window.setTimeout(() => {
      void requestAccess();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [accessGranted, requestAccess, supported]);

  const cancelLearn = useCallback(() => {
    setLearnTarget(null);
  }, []);

  const beginLearn = useCallback((actionId: MidiActionId, mode: MidiLearnMode) => {
    setLearnTarget({ actionId, mode });
  }, []);

  const removeMapping = useCallback((id: string) => {
    setMappings((prev) => prev.filter((mapping) => mapping.id !== id));
  }, []);

  const clearMappings = useCallback(() => {
    setMappings([]);
  }, []);

  const loadTwisterProfile = useCallback(() => {
    const inputId = selectedInputId ?? inputs[0]?.id;
    if (!inputId) return false;
    const inputName =
      inputs.find((input) => input.id === inputId)?.name ?? "Midi Fighter Twister";
    const nextMappings: MidiBinding[] = [];
    TWISTER_PROFILE_PAGES.forEach((page) => {
      page.actions.forEach((actionId, index) => {
        const ccNumber = (page.bank - 1) * 16 + index;
        nextMappings.push({
          id: `${inputId}:cc:0:${ccNumber}:${actionId}:twister-b${page.bank}`,
          inputId,
          inputName,
          messageType: "cc",
          channel: 0,
          number: ccNumber,
          actionId,
          mode: "absolute",
        });
      });
    });
    setMappings(nextMappings);
    return true;
  }, [inputs, selectedInputId]);

  const loadTwisterModeProfile = useCallback(() => {
    const inputId = selectedInputId ?? inputs[0]?.id;
    if (!inputId) return false;
    const inputName =
      inputs.find((input) => input.id === inputId)?.name ?? "Midi Fighter Twister";
    const slotActions: MidiActionId[] = [
      "twister.slot1",
      "twister.slot2",
      "twister.slot3",
      "twister.slot4",
      "twister.slot5",
      "twister.slot6",
      "twister.slot7",
      "twister.slot8",
      "twister.slot9",
      "twister.slot10",
      "twister.slot11",
      "twister.slot12",
      "twister.slot13",
      "twister.slot14",
      "twister.slot15",
    ];
    const nextMappings: MidiBinding[] = slotActions.map((actionId, index) => ({
      id: `${inputId}:cc:0:${index}:${actionId}:twister-mode`,
      inputId,
      inputName,
      messageType: "cc",
      channel: 0,
      number: index,
      actionId,
      mode: "absolute",
    }));
    nextMappings.push({
      id: `${inputId}:cc:0:15:twister.moduleSelect:twister-mode`,
      inputId,
      inputName,
      messageType: "cc",
      channel: 0,
      number: 15,
      actionId: "twister.moduleSelect",
      mode: "absolute",
    });
    nextMappings.push({
      id: `${inputId}:cc:4:11:twister.deckPrev:twister-mode`,
      inputId,
      inputName,
      messageType: "cc",
      channel: 3,
      number: 11,
      actionId: "twister.deckPrev",
      mode: "absolute",
    });
    nextMappings.push({
      id: `${inputId}:note:4:11:twister.deckPrev:twister-mode`,
      inputId,
      inputName,
      messageType: "note",
      channel: 3,
      number: 11,
      actionId: "twister.deckPrev",
      mode: "absolute",
    });
    nextMappings.push({
      id: `${inputId}:cc:4:13:twister.deckNext:twister-mode`,
      inputId,
      inputName,
      messageType: "cc",
      channel: 3,
      number: 13,
      actionId: "twister.deckNext",
      mode: "absolute",
    });
    nextMappings.push({
      id: `${inputId}:note:4:13:twister.deckNext:twister-mode`,
      inputId,
      inputName,
      messageType: "note",
      channel: 3,
      number: 13,
      actionId: "twister.deckNext",
      mode: "absolute",
    });
    setMappings(nextMappings);
    return true;
  }, [inputs, selectedInputId]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mappings));
  }, [mappings]);

  useEffect(() => {
    if (selectedInputId) {
      localStorage.setItem(INPUT_KEY, selectedInputId);
    } else {
      localStorage.removeItem(INPUT_KEY);
    }
  }, [selectedInputId]);

  useEffect(() => {
    if (selectedOutputId) {
      localStorage.setItem(OUTPUT_KEY, selectedOutputId);
    } else {
      localStorage.removeItem(OUTPUT_KEY);
    }
  }, [selectedOutputId]);

  useEffect(() => {
    const access = midiAccessRef.current;
    if (!access) return;
    const selectedIds = new Set(
      selectedInputId ? [selectedInputId] : inputs.map((input) => input.id)
    );
    access.inputs.forEach((port, inputId) => {
      if (!selectedIds.has(inputId)) {
        port.onmidimessage = null;
        return;
      }
      port.onmidimessage = (event) => {
        const data = event.data;
        if (!data || data.length < 3) return;
        const status = data[0];
        const command = status >> 4;
        const channel = status & 0x0f;
        const number = data[1];
        const value = data[2];
        const messageType =
          command === 0x0b ? "cc" : command === 0x09 || command === 0x08 ? "note" : null;
        debugMidi("in.raw", {
          inputId,
          status,
          command,
          channel,
          number,
          value,
          data: Array.from(data),
        });
        if (!messageType) return;

        const matchedInput =
          inputs.find((input) => input.id === inputId)?.name ?? port.name ?? "MIDI Input";

        if (learnTarget) {
          setMappings((prev) => {
            const next: MidiBinding = {
              id: `${inputId}:${messageType}:${channel}:${number}:${learnTarget.actionId}`,
              inputId,
              inputName: matchedInput,
              messageType,
              channel,
              number,
              actionId: learnTarget.actionId,
              mode: learnTarget.mode,
            };
            const withoutConflict = prev.filter(
              (mapping) =>
                !(
                  mapping.inputId === next.inputId &&
                  mapping.messageType === next.messageType &&
                  mapping.channel === next.channel &&
                  mapping.number === next.number
                )
            );
            return [...withoutConflict, next];
          });
          setLearnTarget(null);
          return;
        }

        const matched = mappings.filter(
          (mapping) =>
            mapping.inputId === inputId &&
            mapping.messageType === messageType &&
            mapping.channel === channel &&
            mapping.number === number
        );
        if (matched.length === 0) return;
        debugMidi("in.matched", {
          inputId,
          messageType,
          channel,
          number,
          value,
          bindings: matched.map((mapping) => ({
            id: mapping.id,
            actionId: mapping.actionId,
            mode: mapping.mode,
          })),
        });

        const absolute01 = clamp01(value / 127);
        const relativeDelta =
          messageType === "cc" ? decodeRelativeDelta(value) : value > 0 ? 1 : -1;
        matched.forEach((binding) => {
          mappedValueRef.current({
            binding,
            absolute01,
            relativeDelta,
            rawValue: value,
          });
        });
      };
    });
    return () => {
      access.inputs.forEach((port) => {
        port.onmidimessage = null;
      });
    };
  }, [inputs, learnTarget, mappings, selectedInputId]);

  const sendMappedFeedback = useCallback(
    (actionId: MidiActionId, absolute01: number) => {
      const access = midiAccessRef.current;
      if (!access) return;
      const value = Math.round(clamp01(absolute01) * 127);
      const selectedOutputIds = new Set(
        selectedOutputId ? [selectedOutputId] : outputs.map((output) => output.id)
      );
      mappings
        .filter((binding) => binding.actionId === actionId)
        .forEach((binding) => {
          access.outputs.forEach((output, outputId) => {
            if (!selectedOutputIds.has(outputId)) return;
            const key = `${outputId}:${binding.messageType}:${binding.channel}:${binding.number}`;
            if (lastSentRef.current.get(key) === value) return;
            const statusBase = binding.messageType === "cc" ? 0xb0 : 0x90;
            debugMidi("out.mapped", {
              outputId,
              actionId,
              bindingId: binding.id,
              messageType: binding.messageType,
              channel: binding.channel,
              number: binding.number,
              value,
            });
            output.send([statusBase | (binding.channel & 0x0f), binding.number & 0x7f, value]);
            lastSentRef.current.set(key, value);
          });
        });
    },
    [mappings, outputs, selectedOutputId]
  );

  const sendControlChange = useCallback(
    (number: number, value: number, channel = 0) => {
      const access = midiAccessRef.current;
      if (!access) return;
      const safeNumber = Math.min(Math.max(Math.round(number), 0), 127);
      const safeValue = Math.min(Math.max(Math.round(value), 0), 127);
      const safeChannel = Math.min(Math.max(Math.round(channel), 0), 15);
      const selectedOutputIds = new Set(
        selectedOutputId ? [selectedOutputId] : outputs.map((output) => output.id)
      );
      access.outputs.forEach((output, outputId) => {
        if (!selectedOutputIds.has(outputId)) return;
        debugMidi("out.cc", {
          outputId,
          channel: safeChannel,
          number: safeNumber,
          value: safeValue,
        });
        output.send([0xb0 | safeChannel, safeNumber, safeValue]);
      });
    },
    [outputs, selectedOutputId]
  );

  const sortedMappings = useMemo(
    () =>
      [...mappings].sort((a, b) => {
        if (a.inputName !== b.inputName) return a.inputName.localeCompare(b.inputName);
        if (a.channel !== b.channel) return a.channel - b.channel;
        return a.number - b.number;
      }),
    [mappings]
  );

  return {
    supported,
    accessGranted,
    accessError,
    requestAccess,
    inputs,
    outputs,
    selectedInputId,
    setSelectedInputId,
    selectedOutputId,
    setSelectedOutputId,
    mappings: sortedMappings,
    learnTarget,
    beginLearn,
    cancelLearn,
    removeMapping,
    clearMappings,
    loadTwisterProfile,
    loadTwisterModeProfile,
    sendMappedFeedback,
    sendControlChange,
  };
};

export default useMidiController;
