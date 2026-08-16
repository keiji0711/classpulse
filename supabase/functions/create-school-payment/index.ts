const ALLOWED_ORIGINS = [
  "https://classpulse.pages.dev",
  "https://classpulse101.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "3600",
  };
}

Deno.serve((req) => {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers });

  return new Response(
    JSON.stringify({
      error: "School subscription billing has been retired. Schools receive platform access without a subscription fee.",
    }),
    { status: 410, headers: { ...headers, "Content-Type": "application/json" } },
  );
});
