import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Check, Info, TriangleAlert, X } from "lucide-react";

type ToastVariant = "success" | "error" | "info";
type ToastItem = {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
};
type ToastInput = Omit<ToastItem, "id">;
type ToastContextValue = {
  toast: (item: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const toast = useCallback((item: ToastInput) => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current, { ...item, id }]);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-label="Notifikasi"
        aria-live="polite"
        className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(360px,calc(100%-32px))] flex-col gap-2"
        role="region"
      >
        {items.map((item) => (
          <Toast key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(() => onDismiss(item.id), 4000);
    return () => window.clearTimeout(timeout);
  }, [item.id, onDismiss]);

  const Icon =
    item.variant === "success"
      ? Check
      : item.variant === "error"
        ? TriangleAlert
        : Info;
  const iconColor =
    item.variant === "success"
      ? "text-success"
      : item.variant === "error"
        ? "text-danger"
        : "text-primary";

  return (
    <div className="pointer-events-auto flex items-start gap-3 rounded-2xl border bg-surface p-4 shadow-popover">
      <Icon aria-hidden="true" className={`mt-0.5 ${iconColor}`} size={18} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{item.title}</p>
        {item.description && (
          <p className="mt-1 text-xs leading-5 text-secondary">
            {item.description}
          </p>
        )}
      </div>
      <button
        aria-label="Tutup notifikasi"
        className="text-secondary hover:text-foreground"
        onClick={() => onDismiss(item.id)}
        type="button"
      >
        <X aria-hidden="true" size={16} />
      </button>
    </div>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider.");
  return context.toast;
}
