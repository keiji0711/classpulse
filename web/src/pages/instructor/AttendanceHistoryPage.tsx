import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../contexts/AcademicYearContext';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useCachedState, hasCached } from '../../lib/pageCache';
import { downloadCsv, downloadExcel, type ExportColumn } from '../../lib/export';
import PaginationControls from '../../components/PaginationControls';
import { friendlyReadError, resilientRead } from '../../lib/resilientRequest';
import type { AttendanceRecord } from '../../types';
import { Download, FileSpreadsheet, Search } from 'lucide-react';

export default function AttendanceHistoryPage() {
  const { user } = useAuth();
  const { activeYear } = useAcademicYear();
  const [records, setRecords] = useCachedState<AttendanceRecord[]>('inst-attendance-history', []);
  const [totalRecords, setTotalRecords] = useCachedState<number>('inst-attendance-history-total', 0);
  const [loading, setLoading] = useState(!hasCached('inst-attendance-history'));
  const [error, setError] = useState('');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => { setPage(1); }, [dateFrom, dateTo, activeYear?.id, searchQuery, statusFilter]);
  useEffect(() => { void fetchRecords(); }, [dateFrom, dateTo, activeYear?.id, searchQuery, statusFilter, page, pageSize]);

  useRealtimeRefresh(['attendance_records'], fetchRecords);

  async function fetchRecords() {
    if (!activeYear?.id || !user?.id) {
      setRecords([]);
      setTotalRecords(0);
      setLoading(false);
      return;
    }
    setError('');
    setLoading(true);
    let response;
    try {
      response = await resilientRead((signal) => supabase
        .rpc('get_instructor_attendance_history', {
          p_academic_year_id: activeYear.id,
          p_date_from: dateFrom,
          p_date_to: dateTo,
          p_status: statusFilter === 'all' ? null : statusFilter,
          p_search: searchQuery.trim() || null,
          p_limit: pageSize,
          p_offset: (page - 1) * pageSize,
        })
        .abortSignal(signal));
    } catch (requestError) {
      setError(friendlyReadError(requestError));
      setLoading(false);
      return;
    }
    const { data, error: historyError } = response;
    if (historyError) {
      setError(historyError.message);
      setRecords([]);
      setTotalRecords(0);
      setLoading(false);
      return;
    }
    const result = data as { records?: AttendanceRecord[]; total?: number } | null;
    setRecords(result?.records ?? []);
    setTotalRecords(result?.total ?? 0);
    setLoading(false);
  }

  const statusColors: Record<string, string> = {
    present: 'bg-green-100 text-green-700',
    absent: 'bg-red-100 text-red-700',
    late: 'bg-amber-100 text-amber-700',
    excused: 'bg-blue-100 text-blue-700',
  };

  const exportColumns: ExportColumn<any>[] = [
    { header: 'Date', value: (r: any) => r.date },
    { header: 'Student', value: (r: any) => `${r.student?.last_name ?? ''}, ${r.student?.first_name ?? ''}` },
    { header: 'LRN', value: (r: any) => r.student?.lrn ?? '' },
    { header: 'Subject', value: (r: any) => r.schedule?.subject?.name ?? '' },
    { header: 'Section', value: (r: any) => r.schedule?.section?.name ?? '' },
    { header: 'Status', value: (r: any) => r.status },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-slate-800">Attendance History</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => downloadCsv('attendance-history-page', records, exportColumns)} disabled={records.length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer">
            <Download size={16} /> CSV
          </button>
          <button onClick={() => downloadExcel('attendance-history-page', 'History', records, exportColumns)} disabled={records.length === 0} className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer">
            <FileSpreadsheet size={16} /> Excel
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">From:</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">To:</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none" aria-label="Filter by status">
          <option value="all">All Statuses</option>
          <option value="present">Present</option>
          <option value="absent">Absent</option>
          <option value="late">Late</option>
          <option value="excused">Excused</option>
        </select>
        <div className="flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-lg bg-white min-w-[200px]">
          <Search size={14} className="text-slate-400 shrink-0" />
          <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search student, subject, section..." className="text-sm outline-none w-full" aria-label="Search records" />
        </div>
        <span className="text-sm text-slate-400">{totalRecords} record(s)</span>
      </div>

      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <button type="button" onClick={() => void fetchRecords()} className="shrink-0 rounded-lg bg-white px-3 py-1.5 font-semibold shadow-sm hover:bg-rose-100">Try again</button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Student</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Subject</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Section</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 text-sm text-slate-800">{r.date}</td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-800">{r.student?.last_name}, {r.student?.first_name}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">{r.schedule?.subject?.name ?? '—'}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">{r.schedule?.section?.name ?? '—'}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[r.status] ?? ''}`}>
                        {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                      </span>
                    </td>
                  </tr>
                ))}
                {records.length === 0 && <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-400">No attendance records found.</td></tr>}
              </tbody>
            </table>
          </div>
          <PaginationControls page={page} pageSize={pageSize} totalItems={totalRecords} itemLabel="records" onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} />
        </div>
      )}
    </div>
  );
}
