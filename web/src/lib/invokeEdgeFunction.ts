const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface InvokeEdgeFunctionResult<T> {
  data: T | null;
  error: string | null;
  status: number;
}

export async function invokeEdgeFunction<T>(
  functionName: string,
  accessToken: string,
  body: unknown,
): Promise<InvokeEdgeFunctionResult<T>> {
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    return {
      data: null,
      error: payload?.error ?? payload?.message ?? `Request failed with status ${response.status}`,
      status: response.status,
    };
  }

  return {
    data: payload as T,
    error: null,
    status: response.status,
  };
}
