import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../contexts/AcademicYearContext';
import { useRealtimeRefresh } from '../../lib/useRealtimeRefresh';
import { useToast } from '../../contexts/ToastContext';
import { useCachedState, hasCached } from '../../lib/pageCache';
import { mapEnrollmentRoster } from '../../lib/academicYearRoster';
import type { Schedule, Student, ExamPeriod } from '../../types';
import { ArrowLeft, BookOpen, GraduationCap, Save, Check, Clock, ClipboardList } from 'lucide-react';

const EXAM_PERIODS: { key: ExamPeriod; label: string }[] = [
  { key: '1st_quarter', label: '1st Quarter' },
  { key: '2nd_quarter', label: '2nd Quarter' },
  { key: '3rd_quarter', label: '3rd Quarter' },
];

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

interface ScoreEntry {
  student_id: string;
  score: string;
}

export default function ExamScoresPage() {
  const { user, hasFeature } = useAuth();
  const { activeYear, isViewingCurrentYear, canWriteToActiveYear } = useAcademicYear();
  const { showToast } = useToast();
  const [schedules, setSchedules] = useCachedState<Schedule[]>('inst-exam-scores', []);
  const [loading, setLoading] = useState(!hasCached('inst-exam-scores'));
  const [selectedCard, setSelectedCard] = useState<{ subjectId: string; sectionId: string; subjectName: string; subjectCode: string; sectionName: string; gradeLevel: string } | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [totalItems, setTotalItems] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState<ExamPeriod>('1st_quarter');
  const [loadingScores, setLoadingScores] = useState(false);
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

  useRealtimeRefresh(['schedules', 'exam_scores'], () => {
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
    await loadScores(card.subjectId, card.sectionId, selectedPeriod);
  }

  async function loadScores(subjectId: string, sectionId: string, period: ExamPeriod) {
    setLoadingScores(true);
    const { data: enrollmentData } = activeYear?.id
      ? await supabase
          .from('student_enrollments')
          .select('student_id, section_id, student:students!inner(*), section:sections!inner(*)')
          .eq('school_id', user!.school_id!)
          .eq('academic_year_id', activeYear.id)
          .eq('section_id', sectionId)
          .order('last_name', { foreignTable: 'student' })
      : { data: [] };
    const studentData = mapEnrollmentRoster((enrollmentData ?? []) as any) as Student[];
    setStudents(studentData);

    let scoresQuery = supabase
      .from('exam_scores')
      .select('*')
      .eq('subject_id', subjectId)
      .eq('exam_period', period)
      .in('student_id', studentData.map(s => s.id));
    if (activeYear?.id) scoresQuery = scoresQuery.eq('academic_year_id', activeYear.id);
    const { data: existingScores } = await scoresQuery;

    // Infer total_items from existing data
    const firstWithItems = existingScores?.find(s => s.total_items);
    setTotalItems(firstWithItems ? String(firstWithItems.total_items) : '');

    const scoreMap = new Map<string, number>();
    if (existingScores) {
      for (const s of existingScores) {
        scoreMap.set(s.student_id, s.score);
      }
    }

    const entries: ScoreEntry[] = studentData.map(s => ({
      student_id: s.id,
      score: scoreMap.has(s.id) ? String(scoreMap.get(s.id)) : '',
    }));
    setScores(entries);
    setLoadingScores(false);
  }

  async function handlePeriodChange(period: ExamPeriod) {
    setSelectedPeriod(period);
    setSaved(false);
    if (selectedCard) {
      await loadScores(selectedCard.subjectId, selectedCard.sectionId, period);
    }
  }

  function updateScore(studentId: string, value: string) {
    const max = totalItems ? Number(totalItems) : 200;
    if (value !== '' && (isNaN(Number(value)) || Number(value) < 0 || Number(value) > max)) return;
    setScores(prev => prev.map(s => s.student_id === studentId ? { ...s, score: value } : s));
    setSaved(false);
  }

  function handleTotalItemsChange(value: string) {
    if (value !== '' && (isNaN(Number(value)) || Number(value) < 1 || Number(value) > 200)) return;
    setTotalItems(value);
    setSaved(false);
  }

  // Compute MPS: (sum of all scores / (count * totalItems)) * 100
  const mpsValue = useMemo(() => {
    const items = Number(totalItems);
    if (!items || items <= 0) return null;
    const filledScores = scores.filter(s => s.score !== '').map(s => Number(s.score));
    if (filledScores.length === 0) return null;
    const sum = filledScores.reduce((a, b) => a + b, 0);
    return (sum / (filledScores.length * items)) * 100;
  }, [scores, totalItems]);

  async function handleSave() {
    if (!selectedCard) return;
    if (!gradesWritable) {
      alert(isViewingCurrentYear ? 'Grade/exam features are currently unavailable.' : 'Historical academic years are read-only.');
      return;
    }
    if (!totalItems || Number(totalItems) <= 0) {
      showToast('Please set the total items for this exam.', 'error');
      return;
    }
    setSaving(true);

    const items = Number(totalItems);
    const upserts: any[] = [];
    const cleared: string[] = [];

    for (const entry of scores) {
      if (entry.score !== '' && !isNaN(Number(entry.score))) {
        upserts.push({
          school_id: user!.school_id!,
          student_id: entry.student_id,
          subject_id: selectedCard.subjectId,
          exam_period: selectedPeriod,
          total_items: items,
          score: Number(entry.score),
          created_by: user!.id,
          updated_at: new Date().toISOString(),
          academic_year_id: activeYear?.id ?? null,
        });
      } else {
        cleared.push(entry.student_id);
      }
    }

    if (upserts.length > 0) {
      await supabase.from('exam_scores').upsert(upserts, {
        onConflict: 'student_id,subject_id,exam_period,academic_year_id',
      });
    }

    if (cleared.length > 0) {
      let deleteQuery = supabase
        .from('exam_scores')
        .delete()
        .eq('subject_id', selectedCard.subjectId)
        .eq('exam_period', selectedPeriod)
        .in('student_id', cleared);
      if (activeYear?.id) deleteQuery = deleteQuery.eq('academic_year_id', activeYear.id);
      await deleteQuery;
    }

    setSaving(false);
    setSaved(true);
    showToast('Exam scores saved successfully.');

    // Send notification to parents
    const updatedStudentIds = [...new Set(upserts.map(u => u.student_id))];
    if (updatedStudentIds.length > 0) {
      supabase.functions.invoke('send-grade-notification', {
        body: {
          student_ids: updatedStudentIds,
          subject_name: selectedCard.subjectName,
          subject_code: selectedCard.subjectCode,
          notification_type: 'exam_score',
        },
      }).catch(() => {});
    }
  }

  function getPercentage(entry: ScoreEntry): string {
    if (entry.score === '' || !totalItems || Number(totalItems) <= 0) return '—';
    return ((Number(entry.score) / Number(totalItems)) * 100).toFixed(1) + '%';
  }

  function getPercentageColor(entry: ScoreEntry): string {
    const pct = getPercentage(entry);
    if (pct === '—') return 'text-slate-400';
    const n = parseFloat(pct);
    if (n >= 75) return 'text-green-600';
    return 'text-red-600 font-bold';
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  // ── Score Entry View ──
  if (selectedCard) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => { setSelectedCard(null); setStudents([]); setScores([]); setTotalItems(''); }} className="w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors cursor-pointer">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-slate-800">{selectedCard.subjectName}</h2>
            <p className="text-sm text-slate-500">{selectedCard.subjectCode} &middot; {selectedCard.gradeLevel} - {selectedCard.sectionName}</p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !gradesWritable}
            className="bg-primary hover:bg-primary-dark text-white px-5 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {saved ? <><Check size={16} /> Saved!</> : saving ? 'Saving...' : <><Save size={16} /> Save Scores</>}
          </button>
        </div>

        {/* Period selector & total items */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">Exam Period:</label>
            <select
              value={selectedPeriod}
              onChange={(e) => handlePeriodChange(e.target.value as ExamPeriod)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none"
            >
              {EXAM_PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">Total Items:</label>
            <input
              type="text"
              inputMode="numeric"
              value={totalItems}
              onChange={(e) => handleTotalItemsChange(e.target.value)}
              disabled={!gradesWritable}
              className="w-20 px-3 py-2 border border-slate-300 rounded-lg text-center text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none"
              placeholder="e.g. 50"
            />
          </div>
          {mpsValue !== null && (
            <div className={`ml-auto flex items-center gap-2 px-4 py-2 rounded-xl ${mpsValue >= 75 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'} font-semibold text-sm`}>
              <ClipboardList size={16} />
              MPS: {mpsValue.toFixed(2)}%
            </div>
          )}
        </div>

        {loadingScores ? (
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
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase w-28">Score{totalItems ? ` / ${totalItems}` : ''}</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase w-24">Percentage</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student, idx) => {
                  const entry = scores.find(s => s.student_id === student.id)!;
                  return (
                    <tr key={student.id} className={`border-b border-slate-100 hover:bg-slate-50/50 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                      <td className="px-4 py-3 text-xs text-slate-400">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-slate-800">{student.last_name}, {student.first_name}{student.middle_name ? ` ${student.middle_name.charAt(0)}.` : ''}</div>
                        <div className="text-xs text-slate-400">{student.lrn}</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={entry.score}
                          onChange={e => updateScore(student.id, e.target.value)}
                          disabled={!gradesWritable}
                          className="w-20 px-2 py-1.5 border border-slate-300 rounded-lg text-center text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                          placeholder="—"
                        />
                      </td>
                      <td className={`px-4 py-3 text-center text-sm font-semibold ${getPercentageColor(entry)}`}>
                        {getPercentage(entry)}
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
        <h2 className="text-2xl font-bold text-slate-800">Periodical Test Scores</h2>
        <p className="text-sm text-slate-500 mt-1">Select a subject and section to input exam scores.</p>
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
                  Click to input scores &rarr;
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
