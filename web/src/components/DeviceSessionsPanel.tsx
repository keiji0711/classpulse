import { useCallback, useEffect, useState } from 'react';
import { Laptop, Smartphone } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getDeviceId } from '../lib/deviceSession';
import { useToast } from '../contexts/ToastContext';

type DeviceRow = { id: string; device_id: string; device_name: string; user_agent: string | null; first_seen_at: string; last_seen_at: string; revoked_at: string | null };

export default function DeviceSessionsPanel() {
  const { showToast } = useToast();
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const currentDeviceId = getDeviceId();
  const load = useCallback(async () => {
    const { data } = await supabase.from('user_device_sessions').select('*').order('last_seen_at', { ascending: false });
    setDevices((data as DeviceRow[]) ?? []);
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function revoke(device: DeviceRow) {
    if (!confirm(`Sign out ${device.device_name}?`)) return;
    const { error } = await supabase.rpc('revoke_device_session', { p_device_session_id: device.id });
    if (error) showToast(error.message, 'error');
    else { showToast('Device access revoked.'); await load(); }
  }

  return <div className="space-y-2">
    {devices.length === 0 && <p className="rounded-xl border border-dashed p-4 text-sm text-slate-500">This device will appear after the next session heartbeat.</p>}
    {devices.map((device) => <div key={device.id} className={`flex items-center gap-3 rounded-xl border p-3 ${device.revoked_at ? 'bg-slate-50 opacity-60' : 'bg-white'}`}>
      {/mobile|android|iphone/i.test(device.user_agent ?? '') ? <Smartphone size={19} className="text-slate-500" /> : <Laptop size={19} className="text-slate-500" />}
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{device.device_name} {device.device_id === currentDeviceId && <span className="text-xs font-medium text-primary">· This device</span>}</p><p className="text-xs text-slate-500">Last active {new Date(device.last_seen_at).toLocaleString()}{device.revoked_at ? ` · Revoked ${new Date(device.revoked_at).toLocaleString()}` : ''}</p></div>
      {!device.revoked_at && device.device_id !== currentDeviceId && <button onClick={() => void revoke(device)} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600">Revoke</button>}
    </div>)}
  </div>;
}
