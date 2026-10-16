import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

type PaginationProps = {
  page: number;
  pages: number;
  onPageChange: (page: number) => void;
};

export function Pagination({
  page,
  pages,
  onPageChange,
}: PaginationProps) {
  return (
    <nav
      aria-label="Navigasi halaman tabel"
      className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs text-secondary"
    >
      <span>
        Halaman {page} dari {pages}
      </span>
      <div className="flex items-center gap-1">
        <Button
          aria-label="Halaman sebelumnya"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          size="icon"
          variant="ghost"
        >
          <ChevronLeft aria-hidden="true" size={16} />
        </Button>
        <Button
          aria-label="Halaman berikutnya"
          disabled={page >= pages}
          onClick={() => onPageChange(Math.min(pages, page + 1))}
          size="icon"
          variant="ghost"
        >
          <ChevronRight aria-hidden="true" size={16} />
        </Button>
      </div>
    </nav>
  );
}
