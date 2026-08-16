import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, CheckCircle2, Clock3, Search, ShieldCheck, Users, Download, FileSpreadsheet } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { downloadCsv, downloadExcel, type ExportColumn } from '../../lib/export';

type CollectionSummary = {
  billing_month: string;
  monthly_price: number;
  eligible: number;
  paid: number;
  waived: number;
  collected: number;
  verified: number;
  pending_verification: number;
};

type CollectionRow = {
  student_id: string;
  student_name: string;
  lrn: string;
  section_name: string;
  guardian_name: string;
  payment_id: string | null;
  payment_status: 'paid' | 'waived' | 'refunded' | 'unpaid';
  amount_paid: number;
  collected_at: string | null;
  collector_name: string;
  remittance_status: 'pending' | 'submitted' | 'verified';
  access_enabled: boolean;
  total_count: number;
};

const PAGE_SIZE = 50;

function currentMonthInput() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function ParentCollectionsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [month, setMonth] = useState(currentMonthInput);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<CollectionSummary | null>(null);
  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  const billingMonth = `${month}-01`;

  const loadCollections = useCallback(async () => {
    setLoading(true);
    const [summaryResult, rowsResult] = await Promise.all([
      supabase.rpc('get_school_parent_collection_summary', { p_billing_month: billingMonth }),
      supabase.rpc('get_school_parent_collection_rows', {
        p_billing_month: billingMonth,
        p_search: debouncedSearch,
        p_limit: PAGE_SIZE,
        p_offset: (page - 1) * PAGE_SIZE,
      }),
    ]);

    if (summaryResult.error || rowsResult.error) {
      showToast(summaryResult.error?.message || rowsResult.error?.message || 'Unable to load parent collections.', 'error');
    } else {
      setSummary(summaryResult.data as CollectionSummary);
      setRows((rowsResult.data ?? []) as CollectionRow[]);
    }
    setLoading(false);
  }, [billingMonth, debouncedSearch, page, showToast]);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  useEffect(() => {
    setPage(1);
  }, [month, debouncedSearch]);

  async function verifyPayment(paymentId: string) {
    if (verifying.has(paymentId)) return;
    setVerifying((current) => new Set(current).add(paymentId));
    const { error } = await supabase.rpc('verify_parent_access_payment', { p_payment_id: paymentId });
    setVerifying((current) => {
      const next = new Set(current);
      next.delete(paymentId);
      return next;
    });
    if (error) {
      showToast(error.message || 'Could not verify the collection.', 'error');
      return;
    }
    showToast('Teacher collection verified.');
    await loadCollections();
  }

  const totalRows = Number(rows[0]?.total_count ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const collectionRate = summary?.eligible ? Math.round((summary.paid / summary.eligible) * 100) : 0;
  const expected = Number(summary?.eligible ?? 0) * Number(summary?.monthly_price ?? 20);
  const outstanding = Math.max(0, expected - Number(summary?.collected ?? 0) - Number(summary?.waived ?? 0) * Number(summary?.monthly_price ?? 20));
  const monthLabel = useMemo(() => new Date(`${billingMonth}T00:00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }), [billingMonth]);

  const exportColumns: ExportColumn<CollectionRow>[] = [
    { header: 'Student', value: (row) => row.student_name, width: 28 },
    { header: 'LRN', value: (row) => row.lrn, width: 16 },
    { header: 'Section', value: (row) => row.section_name, width: 22 },
    { header: 'Guardian', value: (row) => row.guardian_name, width: 28 },
    { header: 'Payment Status', value: (row) => row.payment_status, width: 17 },
    { header: 'Amount Paid', value: (row) => Number(row.amount_paid), width: 16, numberFormat: '₱#,##0.00' },
    { header: 'Collection Date', value: (row) => row.collected_at ? new Date(row.collected_at).toLocaleDateString('en-PH') : '', width: 18 },
    { header: 'Collected By', value: (row) => row.collector_name, width: 24 },
    { header: 'Remittance Status', value: (row) => row.payment_id ? row.remittance_status : '', width: 20 },
    { header: 'Parent Access', value: (row) => row.access_enabled ? 'Enabled' : 'Disabled', width: 17 },
  ];

  async function fetchAllRowsForExport() {
    const allRows: CollectionRow[] = [];
    const exportPageSize = 100;
    let offset = 0;
    let expectedTotal = Number.MAX_SAFE_INTEGER;
    while (offset < expectedTotal) {
      const { data, error } = await supabase.rpc('get_school_parent_collection_rows', {
        p_billing_month: billingMonth,
        p_search: debouncedSearch,
        p_limit: exportPageSize,
        p_offset: offset,
      });
      if (error) throw error;
      const batchRows = (data ?? []) as CollectionRow[];
      if (!batchRows.length) break;
      allRows.push(...batchRows);
      expectedTotal = Number(batchRows[0]?.total_count ?? allRows.length);
      offset += batchRows.length;
      if (batchRows.length < exportPageSize) break;
    }
    return allRows;
  }

  async function exportCollections(format: 'csv' | 'excel') {
    if (exporting) return;
    setExporting(true);
    try {
      const exportRows = await fetchAllRowsForExport();
      if (!exportRows.length) {
        showToast('There are no collection records to export for this view.', 'warning');
        return;
      }
      const options = {
        title: 'Parent Collections and Remittance Report',
        subtitle: `${monthLabel} parent app access collections`,
        metadata: [
          { label: 'Search filter', value: debouncedSearch || 'All students' },
          { label: 'Eligible students', value: summary?.eligible ?? 0 },
          { label: 'Paid accounts', value: summary?.paid ?? 0 },
          { label: 'Waived accounts', value: summary?.waived ?? 0 },
          { label: 'Collected amount', value: `PHP ${Number(summary?.collected ?? 0).toLocaleString('en-PH')}` },
          { label: 'Verified amount', value: `PHP ${Number(summary?.verified ?? 0).toLocaleString('en-PH')}` },
          { label: 'Outstanding amount', value: `PHP ${outstanding.toLocaleString('en-PH')}` },
        ],
        generatedBy: user?.full_name,
      };
      if (format === 'csv') downloadCsv(`parent-collections-${month}`, exportRows, exportColumns, options);
      else await downloadExcel(`parent-collections-${month}`, 'Collections', exportRows, exportColumns, options);
    } catch (exportError) {
      showToast(exportError instanceof Error ? exportError.message : 'Unable to export parent collections.', 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Parent Collections</h1>
          <p className="mt-1 text-sm text-slate-500">Verify teacher collections and monitor monthly parent app access.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <button onClick={() => void exportCollections('csv')} disabled={exporting || loading} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Download size={16} /> CSV</button>
          <button onClick={() => void exportCollections('excel')} disabled={exporting || loading} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><FileSpreadsheet size={16} /> {exporting ? 'Preparing...' : 'Excel'}</button>
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Billing month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="mt-1 block rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" /></label>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric title="Eligible Students" value={summary?.eligible ?? 0} icon={<Users size={22} />} tone="slate" />
        <Metric title="Paid Access" value={`${summary?.paid ?? 0} · ${collectionRate}%`} icon={<CheckCircle2 size={22} />} tone="emerald" />
        <Metric title="Collected" value={`₱${Number(summary?.collected ?? 0).toLocaleString('en-PH')}`} icon={<Banknote size={22} />} tone="blue" />
        <Metric title="Verified" value={`₱${Number(summary?.verified ?? 0).toLocaleString('en-PH')}`} icon={<ShieldCheck size={22} />} tone="teal" />
      </div>

      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-4">
        <SmallMetric label="Expected" value={`₱${expected.toLocaleString('en-PH')}`} />
        <SmallMetric label="Outstanding" value={`₱${outstanding.toLocaleString('en-PH')}`} />
        <SmallMetric label="Waived" value={summary?.waived ?? 0} />
        <SmallMetric label="Awaiting verification" value={summary?.pending_verification ?? 0} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-bold text-slate-900">{monthLabel} records</h2><p className="text-xs text-slate-500">{totalRows.toLocaleString()} students</p></div>
          <div className="relative w-full sm:w-80"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search student, LRN, guardian..." className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" /></div>
        </div>

        {loading ? <div className="flex min-h-64 items-center justify-center"><div className="h-9 w-9 animate-spin rounded-full border-4 border-slate-200 border-t-primary" /></div> : rows.length === 0 ? <div className="px-6 py-16 text-center text-sm text-slate-500">No collection records match this view.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50"><tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500"><th className="px-5 py-3">Student</th><th className="px-5 py-3">Guardian / Section</th><th className="px-5 py-3">Payment</th><th className="px-5 py-3">Collected By</th><th className="px-5 py-3">Access</th><th className="px-5 py-3 text-right">Reconciliation</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.student_id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-4"><p className="font-semibold text-slate-900">{row.student_name}</p><p className="mt-0.5 text-xs text-slate-500">LRN {row.lrn}</p></td>
                    <td className="px-5 py-4"><p className="text-sm text-slate-700">{row.guardian_name || 'No guardian recorded'}</p><p className="mt-0.5 text-xs text-slate-500">{row.section_name || 'No section'}</p></td>
                    <td className="px-5 py-4"><StatusBadge status={row.payment_status} />{row.payment_status === 'paid' ? <p className="mt-1 text-xs font-semibold text-slate-600">₱{Number(row.amount_paid).toLocaleString('en-PH')}</p> : null}</td>
                    <td className="px-5 py-4"><p className="text-sm text-slate-700">{row.collector_name || '—'}</p>{row.collected_at ? <p className="mt-0.5 text-xs text-slate-500">{new Date(row.collected_at).toLocaleDateString('en-PH')}</p> : null}</td>
                    <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${row.access_enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{row.access_enabled ? 'Access On' : 'Access Off'}</span></td>
                    <td className="px-5 py-4 text-right">{row.payment_status === 'paid' && row.remittance_status !== 'verified' && row.payment_id ? <button onClick={() => void verifyPayment(row.payment_id!)} disabled={verifying.has(row.payment_id)} className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50">Verify remittance</button> : row.remittance_status === 'verified' ? <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 size={14} /> Verified</span> : <span className="text-xs text-slate-400">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-500"><span>Page {page} of {totalPages}</span><div className="flex gap-2"><button disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold disabled:opacity-40">Previous</button><button disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold disabled:opacity-40">Next</button></div></div>
      </div>
    </div>
  );
}

function Metric({ title, value, icon, tone }: { title: string; value: string | number; icon: React.ReactNode; tone: 'slate' | 'emerald' | 'blue' | 'teal' }) {
  const tones = { slate: 'bg-slate-100 text-slate-600', emerald: 'bg-emerald-100 text-emerald-700', blue: 'bg-blue-100 text-blue-700', teal: 'bg-teal-100 text-teal-700' };
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p><p className="mt-2 text-2xl font-bold text-slate-900">{value}</p></div><div className={`flex h-11 w-11 items-center justify-center rounded-xl ${tones[tone]}`}>{icon}</div></div></div>;
}

function SmallMetric({ label, value }: { label: string; value: string | number }) {
  return <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-lg font-bold text-slate-800">{value}</p></div>;
}

function StatusBadge({ status }: { status: CollectionRow['payment_status'] }) {
  const styles = status === 'paid' ? 'bg-emerald-100 text-emerald-700' : status === 'waived' ? 'bg-blue-100 text-blue-700' : status === 'refunded' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700';
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold capitalize ${styles}`}>{status === 'unpaid' ? <Clock3 size={13} /> : null}{status}</span>;
}
