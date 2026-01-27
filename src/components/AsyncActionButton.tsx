import { useState } from "react";

type AsyncActionButtonProps = {
  idleLabel: string;
  busyLabel: string;
  onAction: () => void | Promise<void>;
  disabled?: boolean;
  className?: string;
  busy?: boolean;
};

const AsyncActionButton = ({
  idleLabel,
  busyLabel,
  onAction,
  disabled = false,
  className,
  busy,
}: AsyncActionButtonProps) => {
  const [internalBusy, setInternalBusy] = useState(false);
  const isBusy = busy ?? internalBusy;

  const handleClick = async () => {
    if (disabled || isBusy) return;
    setInternalBusy(true);
    try {
      await onAction();
    } finally {
      if (busy === undefined) {
        setInternalBusy(false);
      }
    }
  };

  return (
    <button type="button" className={className} onClick={handleClick} disabled={disabled || isBusy}>
      {isBusy ? busyLabel : idleLabel}
    </button>
  );
};

export default AsyncActionButton;
