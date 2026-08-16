import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, DatabaseBackup, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { ensureSupabaseSession } from '../../lib/ensureSupabaseSession';
import { invokeEdgeFunction } from '../../lib/invokeEdgeFunction';

type Tab = 'overview' | 'access' | 'delivery' | 'errors' | 'data';
type Snapshot = { admins:number;mfa_enrolled:number;mfa_required:number;failed_logins_24h:number;active_devices_30d:number;push_attempts_24h:number;push_delivered_24h:number;push_failures_24h:number;stale_tokens_24h:number;failed_jobs:number;open_errors:number;pending_deletions:number;last_backup_check:string|null;last_restore_test:string|null };
type LoginEvent = { id:string;email:string;success:boolean;failure_reason:string|null;ip_address:string|null;user_agent:string|null;created_at:string;school:{name:string}|null };
type NotificationLog = { id:string;type:string;status:string;error_message:string|null;latency_ms:number|null;created_at:string;school:{name:string}|null;student:{first_name:string;last_name:string}|null };
type Job = { id:string;job_type:string;status:string;attempts:number;max_attempts:number;last_error:string|null;next_attempt_at:string|null;created_at:string;school:{name:string}|null };
type ErrorEvent = { id:string;source:string;severity:string;message:string;route:string|null;occurrence_count:number;resolved_at:string|null;last_seen_at:string;school:{name:string}|null };
type Backup = { id:string;backup_type:string;backup_timestamp:string;restore_tested:boolean;result:string;evidence_reference:string|null;notes:string|null;created_at:string };
type Retention = { data_type:string;retention_days:number;enabled:boolean;eligible_rows:number };
type Deletion = { id:string;requester_email:string;target_type:string;reason:string;status:string;created_at:string;school:{name:string}|null };
type AdminAccount = { id:string;email:string;full_name:string;role:string;school:{name:string}|null;mfa_required:boolean;mfa_enrolled:boolean };
type DeviceSession = { id:string;device_name:string;last_seen_at:string;revoked_at:string|null;user:{email:string;full_name:string}|null;school:{name:string}|null };

const EMPTY: Snapshot = { admins:0,mfa_enrolled:0,mfa_required:0,failed_logins_24h:0,active_devices_30d:0,push_attempts_24h:0,push_delivered_24h:0,push_failures_24h:0,stale_tokens_24h:0,failed_jobs:0,open_errors:0,pending_deletions:0,last_backup_check:null,last_restore_test:null };
const tabs: {key:Tab;label:string}[] = [{key:'overview',label:'Overview'},{key:'access',label:'Access & Logins'},{key:'delivery',label:'Push & Retries'},{key:'errors',label:'Errors'},{key:'data',label:'Backups & Data'}];

export default function SecurityReliabilityPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [tab,setTab] = useState<Tab>('overview');
  const [loading,setLoading] = useState(true);
  const [snapshot,setSnapshot] = useState<Snapshot>(EMPTY);
  const [logins,setLogins] = useState<LoginEvent[]>([]);
  const [notifications,setNotifications] = useState<NotificationLog[]>([]);
  const [jobs,setJobs] = useState<Job[]>([]);
  const [errors,setErrors] = useState<ErrorEvent[]>([]);
  const [backups,setBackups] = useState<Backup[]>([]);
  const [retention,setRetention] = useState<Retention[]>([]);
  const [deletions,setDeletions] = useState<Deletion[]>([]);
  const [admins,setAdmins] = useState<AdminAccount[]>([]);
  const [devices,setDevices] = useState<DeviceSession[]>([]);
  const [backupForm,setBackupForm] = useState({ backup_type:'scheduled', backup_timestamp:new Date().toISOString().slice(0,16), result:'passed', restore_tested:false, evidence_reference:'', notes:'' });

  const load = useCallback(async () => {
    setLoading(true);
    const [snap, loginRows, pushRows, jobRows, errorRows, backupRows, retentionRows, deletionRows, userRows, profileRows, deviceRows] = await Promise.all([
      supabase.rpc('get_security_reliability_snapshot'),
      supabase.from('security_login_events').select('*, school:schools(name)').order('created_at',{ascending:false}).limit(100),
      supabase.from('notification_logs').select('id,type,status,error_message,latency_ms,created_at,school:schools(name),student:students(first_name,last_name)').order('created_at',{ascending:false}).limit(150),
      supabase.from('reliability_jobs').select('*, school:schools(name)').order('created_at',{ascending:false}).limit(100),
      supabase.from('application_error_events').select('*, school:schools(name)').order('last_seen_at',{ascending:false}).limit(100),
      supabase.from('backup_verifications').select('*').order('created_at',{ascending:false}).limit(50),
      supabase.rpc('get_retention_preview'),
      supabase.from('data_deletion_requests').select('*, school:schools(name)').order('created_at',{ascending:false}).limit(100),
      supabase.from('users').select('id,email,full_name,role,school:schools(name)').in('role',['super_admin','school_admin']).order('email'),
      supabase.from('admin_security_profiles').select('user_id,mfa_required,mfa_enrolled'),
      supabase.from('user_device_sessions').select('id,device_name,last_seen_at,revoked_at,user:users!user_device_sessions_user_id_fkey(email,full_name),school:schools(name)').order('last_seen_at',{ascending:false}).limit(100),
    ]);
    if (snap.error) showToast(snap.error.message,'error');
    setSnapshot((snap.data as Snapshot) ?? EMPTY);
    setLogins((loginRows.data as unknown as LoginEvent[]) ?? []);
    setNotifications((pushRows.data as unknown as NotificationLog[]) ?? []);
    setJobs((jobRows.data as unknown as Job[]) ?? []);
    setErrors((errorRows.data as unknown as ErrorEvent[]) ?? []);
    setBackups((backupRows.data as Backup[]) ?? []);
    setRetention((retentionRows.data as Retention[]) ?? []);
    setDeletions((deletionRows.data as unknown as Deletion[]) ?? []);
    const profiles = new Map(((profileRows.data ?? []) as {user_id:string;mfa_required:boolean;mfa_enrolled:boolean}[]).map(row => [row.user_id,row]));
    setAdmins(((userRows.data ?? []) as unknown as Omit<AdminAccount,'mfa_required'|'mfa_enrolled'>[]).map(account => ({...account,mfa_required:profiles.get(account.id)?.mfa_required ?? false,mfa_enrolled:profiles.get(account.id)?.mfa_enrolled ?? false})));
    setDevices((deviceRows.data as unknown as DeviceSession[]) ?? []);
    setLoading(false);
  }, [showToast]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const deliveryRate = useMemo(() => snapshot.push_attempts_24h ? Math.round(snapshot.push_delivered_24h/snapshot.push_attempts_24h*100) : 100,[snapshot]);

  async function setMfaRequired(account:AdminAccount) {
    if (account.mfa_required) return;
    const { error } = await supabase.rpc('set_admin_mfa_requirement',{p_user_id:account.id,p_required:true});
    if (error) showToast(error.message,'error'); else { showToast(`MFA required for ${account.email}.`); await load(); }
  }
  async function revokeDevice(device:DeviceSession) {
    if (!confirm(`Revoke ${device.device_name} for ${device.user?.email ?? 'this account'}?`)) return;
    const { error } = await supabase.rpc('revoke_device_session',{p_device_session_id:device.id});
    if (error) showToast(error.message,'error'); else { showToast('Device session revoked.'); await load(); }
  }
  async function retryJob(job:Job) {
    const { session } = await ensureSupabaseSession();
    if (!session) return showToast('Session expired. Sign in again.','error');
    const { error } = await invokeEdgeFunction('retry-background-job',session.access_token,{job_id:job.id});
    if (error) showToast(error,'error'); else { showToast('Retry completed successfully.'); await load(); }
  }
  async function resolveError(id:string) {
    const { error } = await supabase.rpc('resolve_application_error',{p_error_id:id});
    if (error) showToast(error.message,'error'); else await load();
  }
  async function saveBackup(e:FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('backup_verifications').insert({ ...backupForm, backup_timestamp:new Date(backupForm.backup_timestamp).toISOString(), restore_tested_at:backupForm.restore_tested?new Date().toISOString():null, verified_by:user!.id, evidence_reference:backupForm.evidence_reference||null, notes:backupForm.notes||null });
    if (error) showToast(error.message,'error'); else { showToast('Backup verification recorded.'); await load(); }
  }
  async function updateRetention(row:Retention, patch:Partial<Retention>) {
    const { error } = await supabase.from('data_retention_policies').update({...patch,updated_by:user!.id,updated_at:new Date().toISOString()}).eq('data_type',row.data_type);
    if (error) showToast(error.message,'error'); else await load();
  }
  async function reviewDeletion(row:Deletion,status:'approved'|'rejected') {
    const notes = prompt(`Review notes for ${status}:`); if (notes === null) return;
    const { error } = await supabase.rpc('review_data_deletion_request',{p_request_id:row.id,p_status:status,p_notes:notes});
    if (error) showToast(error.message,'error'); else { showToast(`Deletion request ${status}.`); await load(); }
  }

  if (loading) return <div className="flex justify-center py-16"><div className="h-9 w-9 animate-spin rounded-full border-b-2 border-primary" /></div>;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-bold text-slate-900">Security & Reliability</h2><p className="mt-1 text-sm text-slate-500">Identity protection, delivery diagnostics, retries, errors, backups, and data governance.</p></div><button onClick={()=>void load()} className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm"><RefreshCw size={15}/>Refresh</button></div>
    <div className="flex gap-2 overflow-x-auto">{tabs.map(item=><button key={item.key} onClick={()=>setTab(item.key)} className={`whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold ${tab===item.key?'bg-primary text-white':'border bg-white text-slate-600'}`}>{item.label}</button>)}</div>

    {tab==='overview'&&<><div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><Metric label="MFA coverage" value={`${snapshot.mfa_enrolled}/${snapshot.admins}`} tone={snapshot.mfa_enrolled===snapshot.admins?'good':'warn'}/><Metric label="Failed logins · 24h" value={snapshot.failed_logins_24h} tone={snapshot.failed_logins_24h?'bad':'good'}/><Metric label="Push delivery · 24h" value={`${deliveryRate}%`} tone={deliveryRate>=98?'good':deliveryRate>=95?'warn':'bad'}/><Metric label="Failed retry jobs" value={snapshot.failed_jobs} tone={snapshot.failed_jobs?'bad':'good'}/><Metric label="Open app errors" value={snapshot.open_errors} tone={snapshot.open_errors?'warn':'good'}/></div><div className="grid gap-4 md:grid-cols-2"><StatusCard title="Backup verification" good={Boolean(snapshot.last_backup_check)} text={snapshot.last_backup_check?`Last checked ${new Date(snapshot.last_backup_check).toLocaleString()}`:'No backup verification recorded yet.'}/><StatusCard title="Restore testing" good={Boolean(snapshot.last_restore_test)} text={snapshot.last_restore_test?`Last restore test ${new Date(snapshot.last_restore_test).toLocaleString()}`:'A backup is not proven until a restore has been tested.'}/></div></>}

    {tab==='access'&&<div className="space-y-5"><Panel title="Administrator MFA policy"><Table headers={['Administrator','Role / School','Enrolled','Policy','']} rows={admins.map(account=>[<div><p className="font-semibold">{account.full_name}</p><p className="text-xs text-slate-400">{account.email}</p></div>,<span className="capitalize">{account.role.replace('_',' ')}{account.school?.name?` · ${account.school.name}`:''}</span>,<State ok={account.mfa_enrolled} yes="Enabled" no="Missing"/>,<State ok={account.mfa_required} yes="Required" no="Optional"/>,<button disabled={account.mfa_required} onClick={()=>void setMfaRequired(account)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-primary disabled:cursor-default disabled:border-slate-200 disabled:text-slate-400">{account.mfa_required?'Enforced':'Require MFA'}</button>])}/></Panel><Panel title="Tracked administrator devices"><Table headers={['Account','School','Device','Last active','Status / Action']} rows={devices.map(device=>[<div><p className="font-semibold">{device.user?.full_name??'Unknown account'}</p><p className="text-xs text-slate-400">{device.user?.email}</p></div>,device.school?.name??'Platform',device.device_name,new Date(device.last_seen_at).toLocaleString(),device.revoked_at?<span className="text-xs text-slate-400">Revoked</span>:<button onClick={()=>void revokeDevice(device)} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600">Revoke</button>])}/></Panel><Panel title="Recent login activity"><Table headers={['Time','Account','School','Result','IP / Reason']} rows={logins.map(row=>[new Date(row.created_at).toLocaleString(),row.email,row.school?.name??'Platform',<State ok={row.success} yes="Success" no="Failed"/>,<div className="max-w-xs text-xs"><p>{row.ip_address??'Unknown IP'}</p><p className="truncate text-slate-400">{row.failure_reason??row.user_agent??''}</p></div>])}/></Panel></div>}

    {tab==='delivery'&&<div className="space-y-5"><div className="grid grid-cols-3 gap-3"><Metric label="Attempts · 24h" value={snapshot.push_attempts_24h}/><Metric label="Failures · 24h" value={snapshot.push_failures_24h} tone={snapshot.push_failures_24h?'bad':'good'}/><Metric label="Delivery rate" value={`${deliveryRate}%`} tone={deliveryRate>=98?'good':'warn'}/></div><Panel title="Retry queue"><Table headers={['Created','School','Job','Attempts','Status / Error','']} rows={jobs.map(job=>[new Date(job.created_at).toLocaleString(),job.school?.name??'—',job.job_type,`${job.attempts}/${job.max_attempts}`,<div><State ok={job.status==='completed'} yes="Completed" no={job.status}/><p className="mt-1 max-w-xs truncate text-xs text-rose-500">{job.last_error}</p></div>,job.status==='failed'&&job.attempts<job.max_attempts?<button onClick={()=>void retryJob(job)} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white"><RotateCcw size={12}/>Retry</button>:null])}/></Panel><Panel title="Push delivery log"><Table headers={['Time','School / Student','Type','Status','Latency','Error']} rows={notifications.map(row=>[new Date(row.created_at).toLocaleString(),<div><p>{row.school?.name??'—'}</p><p className="text-xs text-slate-400">{row.student?`${row.student.first_name} ${row.student.last_name}`:'—'}</p></div>,row.type,<State ok={row.status==='delivered'} yes="Delivered" no={row.status}/>,row.latency_ms===null?'—':`${row.latency_ms} ms`,<p className="max-w-xs truncate text-xs text-rose-500">{row.error_message??'—'}</p>])}/></Panel></div>}

    {tab==='errors'&&<Panel title="Application errors"><Table headers={['Last seen','Source','School','Severity','Message / Route','']} rows={errors.map(row=>[new Date(row.last_seen_at).toLocaleString(),row.source,row.school?.name??'Platform',<span className={`rounded-full px-2 py-1 text-xs font-bold ${row.severity==='critical'?'bg-rose-100 text-rose-700':'bg-amber-100 text-amber-700'}`}>{row.severity}</span>,<div className="max-w-md"><p className="truncate font-medium">{row.message}</p><p className="truncate text-xs text-slate-400">{row.route??'Unknown route'} · {row.occurrence_count} occurrence(s)</p></div>,!row.resolved_at?<button onClick={()=>void resolveError(row.id)} className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">Resolve</button>:<span className="text-xs text-slate-400">Resolved</span>])}/></Panel>}

    {tab==='data'&&<div className="space-y-5"><div className="grid gap-5 lg:grid-cols-[360px_1fr]"><form onSubmit={saveBackup} className="space-y-3 rounded-2xl border bg-white p-5"><div className="flex items-center gap-2"><DatabaseBackup className="text-primary"/><h3 className="font-bold">Record backup verification</h3></div><select value={backupForm.backup_type} onChange={e=>setBackupForm({...backupForm,backup_type:e.target.value})} className="w-full rounded-xl border p-2.5 text-sm"><option value="scheduled">Scheduled backup</option><option value="point_in_time">Point-in-time recovery</option><option value="manual_export">Manual export</option></select><input type="datetime-local" required value={backupForm.backup_timestamp} onChange={e=>setBackupForm({...backupForm,backup_timestamp:e.target.value})} className="w-full rounded-xl border p-2.5 text-sm"/><select value={backupForm.result} onChange={e=>setBackupForm({...backupForm,result:e.target.value})} className="w-full rounded-xl border p-2.5 text-sm"><option value="passed">Passed</option><option value="partial">Partial</option><option value="failed">Failed</option></select><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={backupForm.restore_tested} onChange={e=>setBackupForm({...backupForm,restore_tested:e.target.checked})}/>Restore was tested</label><input placeholder="Evidence link / ticket" value={backupForm.evidence_reference} onChange={e=>setBackupForm({...backupForm,evidence_reference:e.target.value})} className="w-full rounded-xl border p-2.5 text-sm"/><textarea placeholder="Notes" value={backupForm.notes} onChange={e=>setBackupForm({...backupForm,notes:e.target.value})} className="w-full rounded-xl border p-2.5 text-sm"/><button className="w-full rounded-xl bg-primary py-2.5 font-semibold text-white">Save verification</button></form><Panel title="Backup history"><Table headers={['Checked','Backup time','Type','Result','Restore tested']} rows={backups.map(row=>[new Date(row.created_at).toLocaleString(),new Date(row.backup_timestamp).toLocaleString(),row.backup_type,<State ok={row.result==='passed'} yes={row.result} no={row.result}/>,<State ok={row.restore_tested} yes="Yes" no="No"/>])}/></Panel></div><Panel title="Retention controls (preview only)"><Table headers={['Data','Retention','Eligible now','Automation','']} rows={retention.map(row=>[row.data_type.replaceAll('_',' '),`${row.retention_days} days`,row.eligible_rows.toLocaleString(),<State ok={row.enabled} yes="Policy enabled" no="Disabled"/>,<div className="flex gap-2"><input type="number" min="30" max="3650" defaultValue={row.retention_days} onBlur={e=>{const value=Number(e.target.value);if(value!==row.retention_days)void updateRetention(row,{retention_days:value})}} className="w-20 rounded-lg border px-2 py-1 text-xs"/><button onClick={()=>void updateRetention(row,{enabled:!row.enabled})} className="rounded-lg border px-2 py-1 text-xs font-semibold">{row.enabled?'Disable':'Enable policy'}</button></div>])}/><p className="px-5 pb-4 text-xs text-amber-700">Enabling a policy records the approved rule. Automatic deletion is intentionally disabled until a reviewed scheduled executor is deployed.</p></Panel><Panel title="Deletion requests"><Table headers={['Requested','School','Requester','Target','Reason','Status / Review']} rows={deletions.map(row=>[new Date(row.created_at).toLocaleDateString(),row.school?.name??'Platform',row.requester_email,row.target_type,<p className="max-w-xs truncate">{row.reason}</p>,row.status==='pending'?<div className="flex gap-1"><button onClick={()=>void reviewDeletion(row,'approved')} className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">Approve</button><button onClick={()=>void reviewDeletion(row,'rejected')} className="rounded-lg bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">Reject</button></div>:<span className="capitalize">{row.status}</span>])}/></Panel></div>}
  </div>;
}

function Metric({label,value,tone='plain'}:{label:string;value:number|string;tone?:'plain'|'good'|'warn'|'bad'}) { const style={plain:'border-slate-200',good:'border-emerald-200 bg-emerald-50/40',warn:'border-amber-200 bg-amber-50/40',bad:'border-rose-200 bg-rose-50/40'}[tone]; return <div className={`rounded-2xl border p-4 ${style}`}><p className="text-2xl font-bold text-slate-900">{typeof value==='number'?value.toLocaleString():value}</p><p className="text-xs text-slate-500">{label}</p></div>; }
function StatusCard({title,text,good}:{title:string;text:string;good:boolean}) { return <div className={`flex gap-3 rounded-2xl border p-5 ${good?'border-emerald-200 bg-emerald-50/50':'border-amber-200 bg-amber-50/50'}`}>{good?<CheckCircle2 className="text-emerald-600"/>:<AlertTriangle className="text-amber-600"/>}<div><p className="font-bold text-slate-800">{title}</p><p className="mt-1 text-sm text-slate-600">{text}</p></div></div>; }
function State({ok,yes,no}:{ok:boolean;yes:string;no:string}) { return <span className={`rounded-full px-2 py-1 text-xs font-bold capitalize ${ok?'bg-emerald-100 text-emerald-700':'bg-rose-100 text-rose-700'}`}>{ok?yes:no}</span>; }
function Panel({title,children}:{title:string;children:React.ReactNode}) { return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="flex items-center gap-2 border-b px-5 py-4"><ShieldCheck size={17} className="text-primary"/><h3 className="font-bold text-slate-800">{title}</h3></div>{children}</section>; }
function Table({headers,rows}:{headers:string[];rows:React.ReactNode[][]}) { return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{headers.map((header,index)=><th key={`${header}-${index}`} className="whitespace-nowrap px-4 py-3">{header}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row,rowIndex)=><tr key={rowIndex} className="hover:bg-slate-50/60">{row.map((cell,index)=><td key={index} className="whitespace-nowrap px-4 py-3 text-slate-600">{cell}</td>)}</tr>)}{rows.length===0&&<tr><td colSpan={headers.length} className="px-4 py-10 text-center text-slate-400">No records yet.</td></tr>}</tbody></table></div>; }
