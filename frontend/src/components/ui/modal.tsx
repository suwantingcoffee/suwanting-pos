import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

type ModalProps = {
  open: boolean;
  title: string;
  description?: string;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  footer?: ReactNode;
};

export function Modal({
  open,
  title,
  description,
  onOpenChange,
  children,
  footer,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      className="m-auto max-h-[min(85dvh,700px)] w-[min(520px,calc(100%-32px))] overflow-y-auto rounded-2xl border bg-surface p-0 text-foreground shadow-popover backdrop:bg-black/40"
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onOpenChange(false);
      }}
      onClose={() => onOpenChange(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onOpenChange(false);
        }
      }}
      ref={dialogRef}
    >
      <div className="flex items-start justify-between gap-4 border-b p-5">
        <div>
          <h2 className="text-base font-semibold" id={titleId}>
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-sm text-secondary" id={descriptionId}>
              {description}
            </p>
          )}
        </div>
        <button
          aria-label="Tutup dialog"
          className="rounded-lg p-1.5 text-secondary hover:bg-elevated hover:text-foreground"
          onClick={() => onOpenChange(false)}
          type="button"
        >
          <X aria-hidden="true" size={18} />
        </button>
      </div>
      <div className="p-5">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t p-4">{footer}</div>}
    </dialog>
  );
}

type ConfirmDialogProps = Omit<ModalProps, "children" | "footer"> & {
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
};

export function ConfirmDialog({
  message,
  confirmLabel = "Ya, lanjutkan",
  onConfirm,
  onOpenChange,
  ...props
}: ConfirmDialogProps) {
  return (
    <Modal
      {...props}
      footer={
        <>
          <button
            className="min-h-10 rounded-xl border px-4 text-sm hover:bg-elevated"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            Batal
          </button>
          <button
            className="min-h-10 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            type="button"
          >
            {confirmLabel}
          </button>
        </>
      }
      onOpenChange={onOpenChange}
    >
      <p className="text-sm leading-6 text-secondary">{message}</p>
    </Modal>
  );
}
