import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../contexts/AcademicYearContext';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useCachedState, hasCached } from '../../lib/pageCache';
import type { AttendanceRecord } from '../../types';
import { Download, FileSpreadsheet } from 'lucide-react';
import { downloadCsv, downloadExcel, type ExportColumn } from '../../lib/export';
import PaginationControls from '../../components/PaginationControls';

export default function AttendanceReportsPage() {
  const { user } = useAuth();
  const { activeYear } = useAcademicYear();
  const [records, setRecords] = useCachedState<AttendanceRecord[]>('admin-attendance', []);
  const [totalRecords, setTotalRecords] = useCachedState<number>('admin-attendance-total', 0);
  const [loading, setLoading] = useState(!hasCached('admin-attendance'));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, activeYear?.id]);

  useEffect(() => {
    if (!user?.school_id) return;
    void fetchRecords();
  }, [user?.school_id, dateFrom, dateTo, activeYear?.id, page, pageSize]);

  useRealtimeRefresh(['attendance_records'], fetchRecords);

  async function fetchRecords() {
    const schoolId = user?.school_id;
    if (!schoolId) return;

    const yearId = activeYear?.id;
    const start = (page - 1) * pageSize;
    const end = start + pageSize - 1;

    if (!loading) setRefreshing(true);
    setError('');

    try {
      let query = supabase
        .from('attendance_records')
        .select('*, student:students(first_name, last_name, lrn), schedule:schedules!inner(*, section:sections(name), subject:subjects(name, code), instructor:users(full_name))', { count: 'exact' })
        .eq('schedule.school_id', schoolId)
        .gte('date', dateFrom)
        .lte('date', dateTo);

      if (yearId) query = query.eq('schedule.academic_year_id', yearId);

      const { data, count, error: fetchError } = await query
        .order('date', { ascending: false })
        .order('recorded_at', { ascending: false })
        .range(start, end);

      if (fetchError) throw fetchError;

      setRecords((data as any) ?? []);
      setTotalRecords(count ?? ((data as any[])?.length ?? 0));
    } catch (loadError: any) {
      console.error('Failed to load attendance records', loadError);
      setError(loadError?.message ?? 'Unable to load attendance records right now.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const exportColumns: ExportColumn<AttendanceRecord>[] = [
    { header: 'Date', value: (row) => row.date },
    { header: 'LRN', value: (row: any) => row.student?.lrn ?? '' },
    {
      header: 'Student Name',
      value: (row: any) => `${row.student?.last_name ?? ''}, ${row.student?.first_name ?? ''}`,
    },
    { header: 'Section', value: (row: any) => row.schedule?.section?.name ?? '' },
    { header: 'Subject', value: (row: any) => row.schedule?.subject?.name ?? '' },
    { header: 'Status', value: (row) => row.status },
    { header: 'Teacher', value: (row: any) => row.schedule?.instructor?.full_name ?? '' },
  ];

  function exportCSV() {
    downloadCsv(`attendance_${dateFrom}_to_${dateTo}`, records, exportColumns);
  }

  function exportExcel() {
    downloadExcel(`attendance_${dateFrom}_to_${dateTo}`, 'Attendance', records, exportColumns);
  }

  const statusColors: Record<string, string> = {
    present: 'bg-green-100 text-green-700',
    absent: 'bg-red-100 text-red-700',
    late: 'bg-amber-100 text-amber-700',
    excused: 'bg-blue-100 text-blue-700',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-slate-800">Attendance Reports</h2>
        <div className="flex items-center gap-2">
          <button onClick={exportCSV} disabled={records.length === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer">
            <Download size={16} /> Export CSV
          </button>
          <button onClick={exportExcel} disabled={records.length === 0} className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer">
            <FileSpreadsheet size={16} /> Export Excel
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
        <span className="text-sm text-slate-400">{totalRecords} record(s)</span>
        <span className="text-xs text-slate-500">{refreshing ? 'Refreshing results…' : 'Server-side pagination active'}</span>
      </div>

      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-slate-200">
          <div className="overflow-x-auto max-h-[70vh]">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Student</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Section</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Subject</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Teacher</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 text-sm text-slate-800">{r.date}</td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-800">{r.student?.last_name}, {r.student?.first_name}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">{(r.schedule as any)?.section?.name ?? '—'}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">{r.schedule?.subject?.name ?? '—'}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[r.status] ?? ''}`}>
                        {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">{r.schedule?.instructor?.full_name ?? '—'}</td>
                  </tr>
                ))}
                {records.length === 0 && <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-400">No records found for this date range.</td></tr>}
              </tbody>
            </table>
          </div>
          {totalRecords > 0 && (
            <PaginationControls
              page={page}
              pageSize={pageSize}
              totalItems={totalRecords}
              itemLabel="records"
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
