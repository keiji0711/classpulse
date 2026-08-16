import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../contexts/AcademicYearContext';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useToast } from '../../contexts/ToastContext';
import { useCachedState, hasCached } from '../../lib/pageCache';
import { mapEnrollmentRoster } from '../../lib/academicYearRoster';
import type { Schedule, Student } from '../../types';
import { ArrowLeft, BookOpen, GraduationCap, Save, Check, Clock } from 'lucide-react';

const CARD_COLORS = [
  { bg: 'bg-blue-50', border: 'border-blue-200', accent: 'bg-blue-500', text: 'text-blue-700', light: 'text-blue-500' },
  { bg: 'bg-emerald-50', border: 'border-emerald-200', accent: 'bg-emerald-500', text: 'text-emerald-700', light: 'text-emerald-500' },
  { bg: 'bg-violet-50', border: 'border-violet-200', accent: 'bg-violet-500', text: 'text-violet-700', light: 'text-violet-500' },
  { bg: 'bg-amber-50', border: 'border-amber-200', accent: 'bg-amber-500', text: 'text-amber-700', light: 'text-amber-500' },
  { bg: 'bg-rose-50', border: 'border-rose-200', accent: 'bg-rose-500', text: 'text-rose-700', light: 'text-rose-500' },
  { bg: 'bg-cyan-50', border: 'border-cyan-200', accent: 'bg-cyan-500', text: 'text-cyan-700', light: 'text-cyan-500' },
];

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

interface GradeEntry {
  student_id: string;
  q1: string;
  q2: string;
  q3: string;
}

export default function GradesPage() {
  const { user, hasFeature } = useAuth();
  const { activeYear, isViewingCurrentYear, canWriteToActiveYear } = useAcademicYear();
  const { showToast } = useToast();
  const [schedules, setSchedules] = useCachedState<Schedule[]>('inst-grades', []);
  const [loading, setLoading] = useState(!hasCached('inst-grades'));
  const [selectedCard, setSelectedCard] = useState<{ subjectId: string; sectionId: string; subjectName: string; subjectCode: string; sectionName: string; gradeLevel: string } | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [grades, setGrades] = useState<GradeEntry[]>([]);
  const [loadingGrades, setLoadingGrades] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const gradesEnabled = hasFeature('grades_manage');
  const gradesWritable = gradesEnabled && canWriteToActiveYear;

  useEffect(() => {
    async function load() {
      let query = supabase
        .from('schedules')
        .select('*, subject:subjects(*), section:sections(*)')
        .eq('instructor_id', user!.id);
      if (activeYear?.id) query = query.eq('academic_year_id', activeYear.id);
      const { data } = await query.order('day_of_week').order('time_start');
      setSchedules((data as any) ?? []);
      setLoading(false);
    }
    load();
  }, [user, activeYear]);

  useRealtimeRefresh(['schedules', 'grades'], () => {
    let query = supabase.from('schedules').select('*, subject:subjects(*), section:sections(*)').eq('instructor_id', user!.id);
    if (activeYear?.id) query = query.eq('academic_year_id', activeYear.id);
    query.order('day_of_week').order('time_start').then(({ data }) => setSchedules((data as any) ?? []));
  }, { column: 'instructor_id', value: user?.id });

  const groupedCards = useMemo(() => {
    const map = new Map<string, { subjectName: string; subjectCode: string; sectionName: string; gradeLevel: string; sectionId: string; subjectId: string; schedules: Schedule[] }>();
    schedules.forEach((s) => {
      const key = `${s.subject_id}__${s.section_id}`;
      if (!map.has(key)) {
        map.set(key, { subjectName: s.subject?.name ?? '', subjectCode: s.subject?.code ?? '', sectionName: s.section?.name ?? '', gradeLevel: s.section?.grade_level ?? '', sectionId: s.section_id, subjectId: s.subject_id, schedules: [] });
      }
      map.get(key)!.schedules.push(s);
    });
    return [...map.values()];
  }, [schedules]);

  const subjectColorMap = useMemo(() => {
    const map = new Map<string, number>();
    const ids = [...new Set(schedules.map((s) => s.subject_id))];
    ids.forEach((id, i) => map.set(id, i % CARD_COLORS.length));
    return map;
  }, [schedules]);

  async function selectCard(card: typeof groupedCards[0]) {
    setSelectedCard({ subjectId: card.subjectId, sectionId: card.sectionId, subjectName: card.subjectName, subjectCode: card.subjectCode, sectionName: card.sectionName, gradeLevel: card.gradeLevel });
    setSaved(false);
    setLoadingGrades(true);

    const { data: enrollmentData } = activeYear?.id
      ? await supabase
          .from('student_enrollments')
          .select('student_id, section_id, student:students!inner(*), section:sections!inner(*)')
          .eq('school_id', user!.school_id!)
          .eq('academic_year_id', activeYear.id)
          .eq('section_id', card.sectionId)
          .order('last_name', { foreignTable: 'student' })
      : { data: [] };
    const studentData = mapEnrollmentRoster((enrollmentData ?? []) as any) as Student[];
    setStudents(studentData);

    let gradesQuery = supabase
      .from('grades')
      .select('*')
      .eq('subject_id', card.subjectId)
      .lte('quarter', 3)
      .in('student_id', studentData.map(s => s.id));
    if (activeYear?.id) gradesQuery = gradesQuery.eq('academic_year_id', activeYear.id);
    const { data: existingGrades } = await gradesQuery;

    const gradeMap = new Map<string, Record<number, number>>();
    if (existingGrades) {
      for (const g of existingGrades) {
        if (!gradeMap.has(g.student_id)) gradeMap.set(g.student_id, {});
        gradeMap.get(g.student_id)![g.quarter] = g.grade;
      }
    }

    const entries: GradeEntry[] = studentData.map(s => ({
      student_id: s.id,
      q1: gradeMap.get(s.id)?.[1]?.toString() ?? '',
      q2: gradeMap.get(s.id)?.[2]?.toString() ?? '',
      q3: gradeMap.get(s.id)?.[3]?.toString() ?? '',
    }));
    setGrades(entries);
    setLoadingGrades(false);
  }

  function updateGrade(studentId: string, quarter: 'q1' | 'q2' | 'q3', value: string) {
    // Allow empty or valid numbers 0-100
    if (value !== '' && (isNaN(Number(value)) || Number(value) < 0 || Number(value) > 100)) return;
    setGrades(prev => prev.map(g => g.student_id === studentId ? { ...g, [quarter]: value } : g));
    setSaved(false);
  }

  async function handleSave() {
    if (!selectedCard) return;
    if (!gradesWritable) {
      alert(isViewingCurrentYear ? 'Grade write access is currently unavailable.' : 'Historical academic years are read-only.');
      return;
    }
    setSaving(true);

    const upserts: { school_id: string; student_id: string; subject_id: string; quarter: number; grade: number; created_by: string; updated_at: string; academic_year_id: string | null }[] = [];
    const clearedGrades: Array<{ student_id: string; quarter: number }> = [];

    for (const entry of grades) {
      for (const [key, q] of [['q1', 1], ['q2', 2], ['q3', 3]] as const) {
        const val = entry[key as keyof GradeEntry];
        if (val !== '' && !isNaN(Number(val))) {
          upserts.push({
            school_id: user!.school_id!,
            student_id: entry.student_id,
            subject_id: selectedCard.subjectId,
            quarter: q as number,
            grade: Number(val),
            created_by: user!.id,
            updated_at: new Date().toISOString(),
            academic_year_id: activeYear?.id ?? null,
          });
        } else {
          clearedGrades.push({
            student_id: entry.student_id,
            quarter: q as number,
          });
        }
      }
    }

    if (upserts.length > 0) {
      await supabase.from('grades').upsert(upserts, {
        onConflict: 'student_id,subject_id,quarter,academic_year_id',
      });
    }

    if (clearedGrades.length > 0) {
      await Promise.all(
        clearedGrades.map(({ student_id, quarter }) =>
          supabase
            .from('grades')
            .delete()
            .eq('subject_id', selectedCard.subjectId)
            .eq('student_id', student_id)
            .eq('quarter', quarter)
            .eq('academic_year_id', activeYear!.id)
        )
      );
    }

    setSaving(false);
    setSaved(true);
    showToast('Grades saved successfully.');

    // Send push notifications to parents for updated grades
    const updatedStudentIds = [...new Set(upserts.map(u => u.student_id))];
    if (updatedStudentIds.length > 0) {
      supabase.functions.invoke('send-grade-notification', {
        body: {
          student_ids: updatedStudentIds,
          subject_name: selectedCard.subjectName,
          subject_code: selectedCard.subjectCode,
        },
      }).catch((err) => console.error('Grade notification error:', err));
    }
  }

  function getAverage(entry: GradeEntry): string {
    const vals = [entry.q1, entry.q2, entry.q3].filter(v => v !== '').map(Number);
    if (vals.length === 0) return '—';
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  }

  function getAverageColor(entry: GradeEntry): string {
    const avg = getAverage(entry);
    if (avg === '—') return 'text-slate-400';
    const n = parseFloat(avg);
    if (n >= 75) return 'text-green-600';
    return 'text-red-600 font-bold';
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  // ── Grade Entry View ──
  if (selectedCard) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => { setSelectedCard(null); setStudents([]); setGrades([]); }} className="w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors cursor-pointer">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-slate-800">{selectedCard.subjectName}</h2>
            <p className="text-sm text-slate-500">{selectedCard.subjectCode} &middot; {selectedCard.gradeLevel} - {selectedCard.sectionName}</p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !gradesWritable}
            className="bg-primary hover:bg-primary-dark text-white px-5 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {saved ? <><Check size={16} /> Saved!</> : saving ? 'Saving...' : <><Save size={16} /> Save Grades</>}
          </button>
        </div>

        {loadingGrades ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
        ) : students.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <GraduationCap size={40} className="text-slate-300 mx-auto mb-2" />
            <p className="text-slate-500 font-medium">No students in this section</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase w-8">#</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Student</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase w-24">Q1</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase w-24">Q2</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase w-24">Q3</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase w-24">Average</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student, idx) => {
                  const entry = grades.find(g => g.student_id === student.id)!;
                  return (
                    <tr key={student.id} className={`border-b border-slate-100 hover:bg-slate-50/50 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                      <td className="px-4 py-3 text-xs text-slate-400">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-slate-800">{student.last_name}, {student.first_name}{student.middle_name ? ` ${student.middle_name.charAt(0)}.` : ''}</div>
                        <div className="text-xs text-slate-400">{student.lrn}</div>
                      </td>
                      {(['q1', 'q2', 'q3'] as const).map(q => (
                        <td key={q} className="px-4 py-3 text-center">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={entry[q]}
                            onChange={e => updateGrade(student.id, q, e.target.value)}
                            disabled={!gradesWritable}
                            className="w-16 px-2 py-1.5 border border-slate-300 rounded-lg text-center text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                            placeholder="—"
                          />
                        </td>
                      ))}
                      <td className={`px-4 py-3 text-center text-sm font-semibold ${getAverageColor(entry)}`}>
                        {getAverage(entry)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // ── Card Selection View ──
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Student Grades</h2>
        <p className="text-sm text-slate-500 mt-1">Select a subject and section to manage grades.</p>
      </div>

      {groupedCards.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <BookOpen size={48} className="text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">No schedules assigned yet</p>
          <p className="text-slate-400 text-sm mt-1">Your classes will appear here once the admin assigns them.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groupedCards.map((card) => {
            const ci = subjectColorMap.get(card.subjectId) ?? 0;
            const color = CARD_COLORS[ci];
            const daysSet = new Set(card.schedules.map(s => s.day_of_week));
            const dayLabels = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
              .filter(d => daysSet.has(d as any))
              .map(d => capitalize(d).slice(0, 3));
            const first = card.schedules[0];

            return (
              <button
                key={`${card.subjectId}__${card.sectionId}`}
                onClick={() => selectCard(card)}
                className={`text-left rounded-2xl border-2 ${color.border} ${color.bg} p-5 hover:shadow-lg transition-all cursor-pointer group`}
              >
                <div className={`w-10 h-1.5 rounded-full ${color.accent} mb-4`} />
                <h3 className={`text-lg font-bold ${color.text} mb-0.5`}>{card.subjectName}</h3>
                <p className="text-sm opacity-60 mb-4">{card.subjectCode}</p>
                <div className="flex items-center gap-2 text-sm mb-2">
                  <GraduationCap size={14} className={color.light} />
                  <span className={color.text}>{card.gradeLevel} - {card.sectionName}</span>
                </div>
                <div className="flex items-center gap-2 text-sm mb-2">
                  <Clock size={14} className={color.light} />
                  <span className={color.text}>{formatTime(first.time_start)} – {formatTime(first.time_end)}</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-3">
                  {dayLabels.map(d => (
                    <span key={d} className={`px-2 py-0.5 rounded text-[10px] font-semibold ${color.accent} text-white`}>{d}</span>
                  ))}
                </div>
                <div className={`mt-4 text-xs font-medium ${color.light} opacity-0 group-hover:opacity-100 transition-opacity`}>
                  Click to manage grades &rarr;
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
