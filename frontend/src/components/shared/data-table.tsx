"use client";

import * as React from "react";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { exportCsv } from "@/lib/export";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number | null | undefined;
  exportValue?: (row: T) => string | number | null | undefined;
  align?: "left" | "right";
  className?: string;
}

export interface TableFilter<T> {
  key: string;
  label: string;
  options: string[];
  value: (row: T) => string;
}

interface DataTableProps<T extends { id: string }> {
  rows: T[];
  columns: Column<T>[];
  searchText: (row: T) => string;
  searchPlaceholder?: string;
  filters?: TableFilter<T>[];
  onRowClick?: (row: T) => void;
  exportName?: string;
  pageSize?: number;
  toolbarExtra?: React.ReactNode;
  emptyState?: React.ReactNode;
  dense?: boolean;
}

export function DataTable<T extends { id: string }>({
  rows,
  columns,
  searchText,
  searchPlaceholder = "Search records",
  filters = [],
  onRowClick,
  exportName = "export",
  pageSize = 8,
  toolbarExtra,
  emptyState,
  dense = false,
}: DataTableProps<T>) {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState<Record<string, string>>({});
  const [sortKey, setSortKey] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc");
  const [page, setPage] = React.useState(1);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    let result = rows.filter((row) => {
      const matchesQuery = !needle || searchText(row).toLowerCase().includes(needle);
      const matchesFilters = filters.every((filter) => {
        const selected = active[filter.key];
        return !selected || selected === "All" || filter.value(row) === selected;
      });
      return matchesQuery && matchesFilters;
    });

    if (sortKey) {
      const column = columns.find((col) => col.key === sortKey);
      if (column?.sortValue) {
        result = [...result].sort((a, b) => {
          const left = column.sortValue!(a) ?? "";
          const right = column.sortValue!(b) ?? "";
          if (typeof left === "number" && typeof right === "number") {
            return sortDir === "asc" ? left - right : right - left;
          }
          return sortDir === "asc"
            ? String(left).localeCompare(String(right))
            : String(right).localeCompare(String(left));
        });
      }
    }
    return result;
  }, [rows, query, active, filters, sortKey, sortDir, columns, searchText]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const activeFilterCount = Object.values(active).filter((v) => v && v !== "All").length;

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  }

  function handleExport() {
    const data = filtered.map((row) => {
      const record: Record<string, string | number> = {};
      columns.forEach((column) => {
        const value = column.exportValue
          ? column.exportValue(row)
          : column.sortValue
            ? (column.sortValue(row) ?? "")
            : String((row as Record<string, unknown>)[column.key] ?? "");
        record[column.header] = value ?? "";
      });
      return record;
    });
    exportCsv(exportName, data);
    toast.success("Exported", { description: `${data.length} rows saved as ${exportName}.csv` });
  }

  function clearFilters() {
    setActive({});
    setQuery("");
    setPage(1);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 max-w-sm">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder={searchPlaceholder}
              className="pl-9"
              aria-label={searchPlaceholder}
            />
          </div>
          {filters.map((filter) => (
            <Select
              key={filter.key}
              value={active[filter.key] ?? "All"}
              onValueChange={(value) => {
                setActive((prev) => ({ ...prev, [filter.key]: value }));
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 w-[165px]">
                <SelectValue placeholder={filter.label} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">{filter.label}: All</SelectItem>
                {filter.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
          {(activeFilterCount > 0 || query) && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="size-3.5" /> Clear
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {toolbarExtra}
          <Badge variant="outline" className="gap-1.5">
            <SlidersHorizontal className="size-3" />
            {filtered.length} of {rows.length}
          </Badge>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="size-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] card-shadow">
        <Table>
          <TableHeader className="bg-[color-mix(in_oklab,var(--secondary)_70%,transparent)]">
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  className={cn(column.align === "right" && "text-right", column.className)}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className={cn(
                        "inline-flex items-center gap-1 uppercase transition-colors hover:text-[var(--foreground)]",
                        sortKey === column.key && "text-[var(--primary)]",
                      )}
                    >
                      {column.header}
                      <ArrowUpDown className="size-3" />
                    </button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((row) => (
              <TableRow
                key={row.id}
                onClick={() => onRowClick?.(row)}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={(event) => {
                  if (onRowClick && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    onRowClick(row);
                  }
                }}
                className={cn(
                  onRowClick && "cursor-pointer focus:bg-[var(--secondary)] focus:outline-none",
                  dense && "[&_td]:py-2",
                )}
              >
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    className={cn(column.align === "right" && "text-right", column.className)}
                  >
                    {column.render
                      ? column.render(row)
                      : String((row as Record<string, unknown>)[column.key] ?? "—")}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {!pageRows.length && (
              <TableRow>
                <TableCell colSpan={columns.length} className="p-0">
                  {emptyState ?? (
                    <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">
                      No records match these filters. Clear them to see everything again.
                    </p>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-2.5">
          <p className="text-xs text-[var(--muted-foreground)]">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            {Array.from({ length: totalPages }).slice(0, 6).map((_, index) => (
              <Button
                key={index}
                variant={currentPage === index + 1 ? "default" : "outline"}
                size="icon-sm"
                onClick={() => setPage(index + 1)}
              >
                {index + 1}
              </Button>
            ))}
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
