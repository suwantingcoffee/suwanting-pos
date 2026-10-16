import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/catalog-api";

export function useRemote<T>(loader: () => Promise<T>) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ loader?: () => Promise<T>; revision: number; data?: T; error: string }>({ revision: -1, error: "" });
  const loading = state.loader !== loader || state.revision !== revision;
  useEffect(() => {
    let active = true;
    loader().then(data => { if (active) setState({ loader, revision, data, error: "" }); }, error => { if (active) setState({ loader, revision, error: errorMessage(error) }); });
    return () => { active = false; };
  }, [loader, revision]);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  return { data: loading ? undefined : state.data, error: loading ? "" : state.error, loading, refresh };
}
export function useDebounced(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setDebounced(value), 250); return () => clearTimeout(timer); }, [value]);
  return debounced;
}
export function useExport() {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const toast = useToast();
  return {
    busy,
    run: async (work: () => Promise<void>) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      try {
        await work();
        toast({ title: "CSV berhasil diekspor", variant: "success" });
      } catch (error) {
        toast({ title: "Ekspor gagal", description: errorMessage(error), variant: "error" });
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
  };
}
export function useRequestKey() {
  const previous = useRef({ payload: "", key: crypto.randomUUID() });
  const getKey = (payload: unknown) => {
    const serialized = JSON.stringify(payload);
    if (previous.current.payload && previous.current.payload !== serialized) {
      throw new Error("Permintaan sebelumnya sudah dikirim. Coba ulang dengan data yang sama atau periksa riwayat sebelum membuat mutasi baru.");
    }
    previous.current.payload = serialized;
    return previous.current.key;
  };
  const failed = (error: unknown) => {
    if (error && typeof error === "object" && "code" in error &&
      ["22023", "23514", "23503", "23505", "40001", "42501"].includes(String(error.code))) {
      previous.current = { payload: "", key: crypto.randomUUID() };
    }
  };
  return { getKey, failed };
}
