import { useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

// Table for any number of rows: only the rows in view are rendered
// (virtualized), so 5 000 students scroll as smoothly as 20. Sticky
// header, click a header to sort (Arabic-aware), rows open with click or
// Enter.
export function DataTable<T>({
  rows,
  columns,
  onOpen,
  height = "calc(100vh - 260px)",
  rowHeight = 40,
  empty = "لا توجد بيانات",
  getRowId,
}: {
  rows: T[];
  columns: ColumnDef<T, unknown>[];
  onOpen?: (row: T) => void;
  height?: string;
  rowHeight?: number;
  empty?: string;
  getRowId?: (row: T) => string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId,
    sortingFns: {},
    defaultColumn: {
      sortingFn: (a, b, id) => {
        const x = a.getValue(id), y = b.getValue(id);
        if (typeof x === "number" && typeof y === "number") return x - y;
        return String(x ?? "").localeCompare(String(y ?? ""), "ar", { numeric: true });
      },
    },
  });
  const parent = useRef<HTMLDivElement>(null);
  const model = table.getRowModel().rows;
  const virtual = useVirtualizer({ count: model.length, getScrollElement: () => parent.current, estimateSize: () => rowHeight, overscan: 12 });
  const items = virtual.getVirtualItems();
  const padTop = items.length ? items[0].start : 0;
  const padBottom = items.length ? virtual.getTotalSize() - items[items.length - 1].end : 0;
  const colCount = table.getVisibleLeafColumns().length;

  return (
    <div className="table-wrap" ref={parent} style={{ maxHeight: height }}>
      <table className="list data">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const sorted = h.column.getIsSorted();
                return (
                  <th
                    key={h.id}
                    style={{ width: h.getSize() === 150 ? undefined : h.getSize() }}
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
                  >
                    {h.column.getCanSort() ? (
                      <button className="th-sort" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        <span className="sort-mark">{sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : ""}</span>
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {model.length === 0 && (
            <tr>
              <td colSpan={colCount} className="muted empty-cell">
                {empty}
              </td>
            </tr>
          )}
          {padTop > 0 && (
            <tr aria-hidden>
              <td colSpan={colCount} style={{ height: padTop, padding: 0, border: 0 }} />
            </tr>
          )}
          {items.map((vi) => {
            const row = model[vi.index];
            return (
              <tr
                key={row.id}
                className={onOpen ? "clickable" : undefined}
                style={{ height: rowHeight }}
                tabIndex={onOpen ? 0 : undefined}
                onClick={onOpen ? () => onOpen(row.original) : undefined}
                onKeyDown={onOpen ? (e) => e.key === "Enter" && onOpen(row.original) : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            );
          })}
          {padBottom > 0 && (
            <tr aria-hidden>
              <td colSpan={colCount} style={{ height: padBottom, padding: 0, border: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
