/**
 * Heisenberg Worker
 *
 * - Everything except /ws is served from the static assets (the web client).
 * - /ws proxies WebSocket connections to the multiplayer server in MC_SERVER.
 *   Browsers on an https:// page can only open wss:// sockets, and the bundled
 *   EaglercraftBungee only speaks plain ws://, so the Worker terminates TLS and
 *   forwards the connection. The player's real IP is passed in X-Real-IP so the
 *   server's per-IP rate limits keep working (set forward_ip: true in Bungee).
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/ws" || url.pathname.startsWith("/ws/")) {
      return proxyWebSocket(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

async function proxyWebSocket(request, env) {
  if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket upgrade", { status: 426 });
  }
  if (!env.MC_SERVER) {
    return new Response("Multiplayer proxy is not configured, set MC_SERVER", { status: 503 });
  }

  let upstream;
  try {
    upstream = new URL(env.MC_SERVER.replace(/^ws(s?):\/\//i, "http$1://"));
  } catch (e) {
    return new Response("MC_SERVER is not a valid URL", { status: 500 });
  }

  const headers = new Headers(request.headers);
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) {
    headers.set("X-Real-IP", clientIp);
  }

  // returning the upstream 101 response hands the socket pair back to the runtime,
  // which pipes frames both ways without the Worker staying on the CPU
  return fetch(upstream.toString(), { method: "GET", headers });
}
