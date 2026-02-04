import type { DeckFxPanelState, DeckState } from "../types/deck";

const FX_PANEL_STORAGE_KEY = "fxPanelState:v1";

type FxPanelPatch = Record<number, Partial<DeckFxPanelState>>;

export const buildFxPanelPatch = (decks: DeckState[]): FxPanelPatch =>
  Object.fromEntries(decks.map((deck) => [deck.id, deck.fxPanelOpen]));

export const saveFxPanelPatch = (patch: FxPanelPatch) => {
  try {
    window.localStorage.setItem(FX_PANEL_STORAGE_KEY, JSON.stringify(patch));
  } catch {
    // ignore storage failures in private/incognito contexts
  }
};

export const loadFxPanelPatch = (): FxPanelPatch => {
  try {
    const raw = window.localStorage.getItem(FX_PANEL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.entries(parsed).reduce<FxPanelPatch>((acc, [key, value]) => {
      const id = Number(key);
      if (!Number.isFinite(id) || !value || typeof value !== "object") return acc;
      acc[id] = value as Partial<DeckFxPanelState>;
      return acc;
    }, {});
  } catch {
    return {};
  }
};
