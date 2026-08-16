import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AttendanceIntervention, InterventionAction, Student, AppUser } from '../types';
import { X, Plus, ChevronDown, AlertCircle, CheckCircle, Clock, Zap } from 'lucide-react';

interface StudentInterventionModalProps {
  student: Student & { last_name?: string; first_name?: string };
  studentAbsenceRate: number;
  onClose: () => void;
  schoolId: string;
  userId: string;
}

export default function StudentInterventionModal({
  student,
  studentAbsenceRate,
  onClose,
  schoolId,
  userId,
}: StudentInterventionModalProps) {
  const [interventions, setInterventions] = useState<(AttendanceIntervention & { created_by_user?: AppUser })[]>([]);
  const [, setActionLogs] = useState<InterventionAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    action_type: 'call_parent' as const,
    notes: '',
    follow_up_date: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchInterventions();
  }, [student.id, schoolId]);

  async function fetchInterventions() {
    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('attendance_interventions')
        .select('*, created_by_user:users!created_by(id, full_name, email)')
        .eq('student_id', student.id)
        .eq('school_id', schoolId)
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      setInterventions((data as any) ?? []);
    } catch (err) {
      console.error('Failed to fetch interventions', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchActionLogs(interventionId: string) {
    try {
      const { data, error: fetchError } = await supabase
        .from('intervention_actions')
        .select('*, created_by_user:users!created_by(id, full_name)')
        .eq('intervention_id', interventionId)
        .order('created_at', { ascending: true });

      if (fetchError) throw fetchError;
      setActionLogs((data as any) ?? []);
    } catch (err) {
      console.error('Failed to fetch action logs', err);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.notes.trim()) {
      setError('Please enter intervention notes');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      // Create intervention
      const { data: intData, error: intError } = await supabase
        .from('attendance_interventions')
        .insert({
          school_id: schoolId,
          student_id: student.id,
          created_by: userId,
          action_type: formData.action_type,
          notes: formData.notes,
          follow_up_date: formData.follow_up_date || null,
          status: 'pending',
        })
        .select()
        .single();

      if (intError) throw intError;

      // Log action
      await supabase.from('intervention_actions').insert({
        intervention_id: intData.id,
        action_type: 'created',
        description: `Intervention created: ${formData.action_type.replace(/_/g, ' ')}`,
        created_by: userId,
      });

      // Reset form and refetch
      setFormData({ action_type: 'call_parent', notes: '', follow_up_date: '' });
      setShowForm(false);
      await fetchInterventions();
    } catch (err: any) {
      console.error('Failed to create intervention', err);
      setError(err?.message ?? 'Failed to create intervention');
    } finally {
      setSubmitting(false);
    }
  }

  const actionTypeLabels: Record<string, string> = {
    call_parent: '📞 Call Parent',
    sms: '💬 Send SMS',
    email: '📧 Email',
    meeting_scheduled: '📅 Meeting Scheduled',
    home_visit: '🏠 Home Visit',
    referral: '🔗 Referral',
    other: '📝 Other',
  };

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    in_progress: 'bg-blue-50 border-blue-200 text-blue-800',
    completed: 'bg-green-50 border-green-200 text-green-800',
    resolved: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    escalated: 'bg-red-50 border-red-200 text-red-800',
  };

  const statusIcons: Record<string, React.ReactNode> = {
    pending: <Clock size={16} />,
    in_progress: <Zap size={16} />,
    completed: <CheckCircle size={16} />,
    resolved: <CheckCircle size={16} />,
    escalated: <AlertCircle size={16} />,
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 p-5 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-800">
              {student.last_name}, {student.first_name}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              LRN: {student.lrn} • Absence Rate: <span className="font-semibold text-red-600">{studentAbsenceRate.toFixed(1)}%</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-6">
          {/* Action Button */}
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="w-full bg-primary hover:bg-primary-dark text-white font-medium py-2 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <Plus size={18} /> Log New Intervention
            </button>
          )}

          {/* Intervention Form */}
          {showForm && (
            <form onSubmit={handleSubmit} className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Action Type</label>
                <select
                  value={formData.action_type}
                  onChange={e => setFormData({ ...formData, action_type: e.target.value as any })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                >
                  <option value="call_parent">📞 Call Parent</option>
                  <option value="sms">💬 Send SMS</option>
                  <option value="email">📧 Email</option>
                  <option value="meeting_scheduled">📅 Meeting Scheduled</option>
                  <option value="home_visit">🏠 Home Visit</option>
                  <option value="referral">🔗 Referral</option>
                  <option value="other">📝 Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={e => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Document what was done, outcome, next steps..."
                  rows={4}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Follow-up Date (Optional)</label>
                <input
                  type="date"
                  value={formData.follow_up_date}
                  onChange={e => setFormData({ ...formData, follow_up_date: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2 rounded-lg flex items-center gap-2">
                  <AlertCircle size={16} />
                  {error}
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-slate-700 border border-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save Intervention'}
                </button>
              </div>
            </form>
          )}

          {/* Interventions List */}
          <div>
            <h3 className="text-lg font-semibold text-slate-800 mb-3">
              Intervention History ({interventions.length})
            </h3>
            {loading ? (
              <div className="text-center py-8 text-slate-400">Loading...</div>
            ) : interventions.length === 0 ? (
              <div className="text-center py-8 text-slate-400">No interventions logged yet</div>
            ) : (
              <div className="space-y-2">
                {interventions.map(intervention => (
                  <div
                    key={intervention.id}
                    className={`border rounded-lg p-4 cursor-pointer transition-all ${statusColors[intervention.status]}`}
                  >
                    <div
                      onClick={() => setExpandedId(expandedId === intervention.id ? null : intervention.id)}
                      className="flex items-start justify-between"
                    >
                      <div className="flex items-start gap-3 flex-1">
                        <div className="mt-1">{statusIcons[intervention.status]}</div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold">{actionTypeLabels[intervention.action_type]}</span>
                            <span className="text-xs font-medium bg-white bg-opacity-50 px-2 py-0.5 rounded">
                              {intervention.status}
                            </span>
                          </div>
                          <p className="text-sm mb-1">{intervention.notes}</p>
                          <p className="text-xs opacity-75">
                            By {intervention.created_by_user?.full_name} • {new Date(intervention.created_at).toLocaleDateString()}
                          </p>
                          {intervention.follow_up_date && (
                            <p className="text-xs mt-1 font-medium">
                              📅 Follow-up: {new Date(intervention.follow_up_date).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>
                      <ChevronDown
                        size={18}
                        className={`transition-transform ${expandedId === intervention.id ? 'rotate-180' : ''}`}
                      />
                    </div>

                    {/* Expanded Details */}
                    {expandedId === intervention.id && (
                      <div className="mt-4 pt-4 border-t border-current border-opacity-20 space-y-3">
                        {intervention.outcome && (
                          <div>
                            <p className="text-xs font-semibold opacity-75 mb-1">Outcome:</p>
                            <span className="text-sm font-medium capitalize">
                              {intervention.outcome === 'improved'
                                ? '📈 Improved'
                                : intervention.outcome === 'stable'
                                  ? '⏸️ Stable'
                                  : intervention.outcome === 'declined'
                                    ? '📉 Declined'
                                    : '🚨 Critical'}
                            </span>
                          </div>
                        )}
                        <button
                          onClick={() => fetchActionLogs(intervention.id)}
                          className="text-xs font-medium opacity-75 hover:opacity-100 underline transition-opacity"
                        >
                          View Activity Log
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
