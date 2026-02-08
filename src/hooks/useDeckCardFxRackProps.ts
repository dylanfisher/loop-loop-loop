import { useMemo } from "react";
import type { DeckCardProps } from "../components/DeckCard";

export const useDeckCardFxRackProps = (props: DeckCardProps): DeckCardProps =>
  useMemo(
    () => ({
      ...props,
      zipDragActive: props.zipDragActive ?? false,
    }),
    [props]
  );

