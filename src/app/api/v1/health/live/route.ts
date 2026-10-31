// Liveness: the process is up and answering. It deliberately touches nothing
// else, so a database blip never makes the platform restart every server.
// Readiness (with a database check) is GET /api/v1/health.
export function GET() {
  return Response.json({ status: "ok", uptimeSec: Math.round(process.uptime()) }, { headers: { "Cache-Control": "no-store" } });
}
