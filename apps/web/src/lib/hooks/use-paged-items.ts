import { useState } from "react";
import type { PaginationMeta } from "@booking/shared";

/**
 * Client-side paging for a list the server already returns in full (a per-provider
 * schedule, an aggregated report row set, clinic holidays) — slices it down so the
 * table only renders one page's worth of rows at a time, with the same `meta` shape
 * the server-paginated `<Pagination>` component expects.
 */
export function usePagedItems<T>(items: readonly T[] | undefined, pageSize = 20) {
  const [page, setPage] = useState(1);
  const total = items?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Clamped, not reset: a refetch after some other mutation shouldn't yank the user back to page 1.
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pageItems = items?.slice(start, start + pageSize) ?? [];
  const meta: PaginationMeta | undefined = items ? { page: safePage, pageSize, total, totalPages } : undefined;

  return { pageItems, meta, setPage };
}
