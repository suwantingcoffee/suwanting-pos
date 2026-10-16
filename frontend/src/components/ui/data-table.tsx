import type { ReactNode } from "react";

export type TableColumn<T> = {
  key: string;
  header: string;
  className?: string;
  render: (row: T) => ReactNode;
};

type DataTableProps<T> = {
  columns: TableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
};

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
}: DataTableProps<T>) {
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full min-w-[570px] border-collapse text-left text-xs">
        <thead>
          <tr className="border-y bg-elevated text-[10px] uppercase tracking-wider text-secondary">
            {columns.map((column) => (
              <th
                className={`px-4 py-3 font-medium ${column.className ?? ""}`}
                key={column.key}
                scope="col"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              className="border-b last:border-0"
              key={getRowKey(row)}
            >
              {columns.map((column) => (
                <td
                  className={`px-4 py-3.5 ${column.className ?? ""}`}
                  key={column.key}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
