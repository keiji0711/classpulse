import AsyncStorage from '@react-native-async-storage/async-storage';
import { FUNCTIONS_URL, SUPABASE_ANON_KEY, supabase, getAuthHeaders } from './supabase';
import { fetchWithTimeout } from './fetchWithTimeout';
import type { AttendanceSubmissionPayload } from '../types';

const ATTENDANCE_QUEUE_KEY = 'classpulse_instructor_attendance_queue';

export interface QueuedAttendanceItem extends AttendanceSubmissionPayload {
  id: string;
  created_at: string;
}

interface QueueSyncResult {
  synced: number;
  remaining: number;
}

async function readQueue(): Promise<QueuedAttendanceItem[]> {
  const raw = await AsyncStorage.getItem(ATTENDANCE_QUEUE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as QueuedAttendanceItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: QueuedAttendanceItem[]) {
  await AsyncStorage.setItem(ATTENDANCE_QUEUE_KEY, JSON.stringify(items));
}

async function sendPushForRecords(records: any[]) {
  for (const record of records) {
    try {
      const res = await fetchWithTimeout(`${FUNCTIONS_URL}/send-push-notification`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ record }),
      });
      const json = await res.json().catch(() => ({}));
      if (__DEV__) console.log(`[Push] student=${record.student_id} http=${res.status}`, JSON.stringify(json));
    } catch (err) {
      if (__DEV__) console.warn('[Push] Network error sending notification:', err);
    }
  }
}

export async function submitAttendancePayload(payload: AttendanceSubmissionPayload) {
  const rows = payload.entries.map((entry) => ({
    schedule_id: payload.schedule_id,
    student_id: entry.student_id,
    date: payload.date,
    status: entry.status,
    recorded_by: payload.recorded_by,
  }));

  const { data, error } = await supabase
    .from('attendance_records')
    .upsert(rows, { onConflict: 'schedule_id,student_id,date' })
    .select();

  if (error) {
    throw error;
  }

  await sendPushForRecords(data ?? []);
  return data ?? [];
}

export async function enqueueAttendancePayload(payload: AttendanceSubmissionPayload) {
  const queue = await readQueue();
  queue.push({
    ...payload,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    created_at: new Date().toISOString(),
  });
  await writeQueue(queue);
}

export async function getQueuedAttendanceCount() {
  const queue = await readQueue();
  return queue.length;
}

export async function flushQueuedAttendance(): Promise<QueueSyncResult> {
  const queue = await readQueue();

  if (queue.length === 0) {
    return { synced: 0, remaining: 0 };
  }

  const remaining: QueuedAttendanceItem[] = [];
  let synced = 0;

  for (const item of queue) {
    try {
      await submitAttendancePayload(item);
      synced += 1;
    } catch {
      remaining.push(item);
    }
  }

  await writeQueue(remaining);
  return { synced, remaining: remaining.length };
}
