/**
 * A JSON `Response`, as the backend answers: what a fake `fetch` hands the
 * RPC client.
 * @param body The value to serialize as the body.
 * @param status The status code, 200 unless given.
 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}
