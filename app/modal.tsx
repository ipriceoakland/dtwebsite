"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

type ModalProps = {
  title: string;
  small?: boolean;
  onClose: () => void;
  children: ReactNode;
};

// Native <dialog> gives us focus trapping, Escape to close and a backdrop.
export function Modal({ title, small = false, onClose, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className={small ? "modal modal-small" : "modal"}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Clicks on the dialog element itself land on the backdrop.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-body">
        <h2 id={titleId} className="modal-title">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}
