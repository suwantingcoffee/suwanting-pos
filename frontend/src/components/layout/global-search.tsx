import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { appRoutes } from "@/lib/navigation";

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const matches = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("id-ID");
    if (!normalizedQuery) return [];

    return appRoutes
      .filter((route) => route.label.toLocaleLowerCase("id-ID").includes(normalizedQuery))
      .slice(0, 5);
  }, [query]);

  useEffect(() => {
    function closeOnOutside(event: MouseEvent) {
      if (
        event.target instanceof Node &&
        !wrapperRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, []);

  function selectRoute(path: string) {
    navigate(path);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="relative w-full max-w-[260px]" ref={wrapperRef}>
      <label className="relative block">
        <span className="sr-only">Cari modul POS</span>
        <Search
          aria-hidden="true"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary"
          size={16}
        />
        <Input
          aria-autocomplete="list"
          aria-expanded={open && matches.length > 0}
          aria-label="Pencarian global"
          aria-controls="global-search-results"
          className="h-10 pl-9 pr-12 text-xs"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              event.currentTarget.blur();
            }
            if (event.key === "Enter" && matches[0]) {
              event.preventDefault();
              selectRoute(matches[0].path);
            }
          }}
          placeholder="Cari menu..."
          role="combobox"
          type="search"
          value={query}
        />
        <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded border bg-background px-1.5 py-0.5 text-[9px] text-secondary">
          /
        </kbd>
      </label>
      {open && query.trim() && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 rounded-2xl border bg-surface p-1.5 shadow-popover"
          id="global-search-results"
          role="listbox"
        >
          {matches.length ? (
            matches.map((route) => {
              const Icon = route.icon;
              return (
                <button
                  aria-label={`Buka ${route.label}`}
                  className="flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 text-left text-xs hover:bg-elevated"
                  key={route.path}
                  onClick={() => selectRoute(route.path)}
                  role="option"
                  type="button"
                >
                  <Icon aria-hidden="true" className="text-secondary" size={16} />
                  {route.label}
                </button>
              );
            })
          ) : (
            <p className="px-3 py-3 text-xs text-secondary">
              Modul tidak ditemukan.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
