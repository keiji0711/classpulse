import { supabase } from './supabase';

const DEVICE_ID_KEY = 'classpulse_device_id';

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function rotateDeviceId() {
  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

export function getDeviceName() {
  const ua = navigator.userAgent;
  const browser = ua.includes('Edg/') ? 'Edge' : ua.includes('Chrome/') ? 'Chrome' : ua.includes('Firefox/') ? 'Firefox' : ua.includes('Safari/') ? 'Safari' : 'Browser';
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || 'Unknown device';
  return `${browser} on ${platform}`;
}

export async function registerCurrentDevice() {
  return supabase.rpc('register_device_session', {
    p_device_id: getDeviceId(),
    p_device_name: getDeviceName(),
    p_user_agent: navigator.userAgent,
  });
}
