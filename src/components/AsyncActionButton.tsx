import { useEffect, useRef, useState } from "react";

type AsyncActionButtonProps = {
  idleLabel: string;
  busyLabel: string;
  onAction: () => void | Promise<void>;
  disabled?: boolean;
  className?: string;
  busy?: boolean;
  title?: string;
  successLabel?: string;
  successDurationMs?: number;
};

const AsyncActionButton = ({
  idleLabel,
  busyLabel,
  onAction,
  disabled = false,
  className,
  busy,
  title,
  successLabel,
  successDurationMs = 1200,
}: AsyncActionButtonProps) => {
  const [internalBusy, setInternalBusy] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const successTimeoutRef = useRef<number | null>(null);
  const isBusy = busy ?? internalBusy;

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current !== null) {
        window.clearTimeout(successTimeoutRef.current);
        successTimeoutRef.current = null;
      }
    };
  }, []);

  const handleClick = async () => {
    if (disabled || isBusy) return;
    setInternalBusy(true);
    setShowSuccess(false);
    try {
      await onAction();
      if (successLabel) {
        setShowSuccess(true);
        if (successTimeoutRef.current !== null) {
          window.clearTimeout(successTimeoutRef.current);
        }
        const safeDuration = Math.max(250, successDurationMs);
        successTimeoutRef.current = window.setTimeout(() => {
          setShowSuccess(false);
          successTimeoutRef.current = null;
        }, safeDuration);
      }
    } finally {
      if (busy === undefined) {
        setInternalBusy(false);
      }
    }
  };

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      disabled={disabled || isBusy}
      title={title}
    >
      {isBusy ? busyLabel : showSuccess ? successLabel : idleLabel}
    </button>
  );
};

export default AsyncActionButton;
