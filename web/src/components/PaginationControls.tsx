interface PaginationControlsProps {
  page: number;
  pageSize: number;
  totalItems: number;
  itemLabel?: string;
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export default function PaginationControls({
  page,
  pageSize,
  totalItems,
  itemLabel = 'items',
  pageSizeOptions = [10, 25, 50, 100],
  onPageChange,
  onPageSizeChange,
}: PaginationControlsProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = totalItems === 0 ? 0 : Math.min(totalItems, safePage * pageSize);

  return (
    <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-slate-600">
        Showing <span className="font-semibold text-slate-800">{start}-{end}</span> of{' '}
        <span className="font-semibold text-slate-800">{totalItems}</span> {itemLabel}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Rows</label>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        >
          {pageSizeOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage <= 1}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Previous
        </button>

        <span className="text-sm font-medium text-slate-600">
          Page <span className="text-slate-800">{safePage}</span> of <span className="text-slate-800">{totalPages}</span>
        </span>

        <button
          type="button"
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= totalPages}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
