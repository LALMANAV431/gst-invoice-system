/**
 * List pagination.
 *
 * Several list endpoints previously returned every row for a company, with
 * relations joined. That is fine with seed data and fails badly for a real
 * tenant: `GET /api/invoices` on a shop with 50,000 invoices would load all of
 * them, join the party on each, and serialise the lot.
 */

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export type Pagination = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
};

/** Read `?page=` and `?pageSize=`, clamped to sane bounds. */
export function parsePagination(req: Request): Pagination {
  const url = new URL(req.url);
  const rawPage = parseInt(url.searchParams.get("page") ?? "1", 10);
  const rawSize = parseInt(url.searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = Number.isFinite(rawSize)
    ? Math.min(Math.max(rawSize, 1), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export type Paginated<T> = {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
};

/** Wrap rows in a consistent envelope so clients can page reliably. */
export function paginated<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number
): Paginated<T> {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    data,
    page,
    pageSize,
    total,
    totalPages,
    hasMore: page < totalPages,
  };
}
