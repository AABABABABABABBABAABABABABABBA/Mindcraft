// End-to-end check of the LAN relay protocol against a running worker:
//   node test/relay-protocol.mjs ws://localhost:8787/relay
const RELAY = process.argv[2] || "ws://localhost:8787/relay";

const enc = (bytes) => new Uint8Array(bytes);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const a8 = (s) => [s.length, ...ascii(s)];
const a16 = (s) => [(s.length >> 8) & 255, s.length & 255, ...ascii(s)];
const handshake = (type, code) => enc([0x00, type, 1, ...a8(code)]);
const desc = (peer, d) => enc([0x04, ...a8(peer), ...a16(d)]);
const cand = (peer, c) => enc([0x03, ...a8(peer), ...a16(c)]);
const success = (id) => enc([0x05, ...a8(id)]);

function read8(b, p) { const n = b[p]; return [String.fromCharCode(...b.slice(p + 1, p + 1 + n)), p + 1 + n]; }
function read16(b, p) { const n = (b[p] << 8) | b[p + 1]; return [String.fromCharCode(...b.slice(p + 2, p + 2 + n)), p + 2 + n]; }

function parse(buf) {
	const b = new Uint8Array(buf);
	const id = b[0];
	let p = 1, s, t;
	switch (id) {
		case 0x00: [s] = read8(b, 3); return { id, type: b[1], version: b[2], code: s };
		case 0x01: {
			const n = (b[1] << 8) | b[2]; p = 3; const list = [];
			for (let i = 0; i < n; ++i) { const kind = String.fromCharCode(b[p++]); [s, p] = read16(b, p); [t, p] = read8(b, p); [, p] = read8(b, p); list.push(kind + ":" + s + (t ? " (with credentials)" : "")); }
			return { id, servers: list };
		}
		case 0x02: case 0x05: case 0x06: [s] = read8(b, 1); return { id, peer: s };
		case 0x03: case 0x04: [s, p] = read8(b, 1); [t] = read16(b, p); return { id, peer: s, data: t };
		case 0x07: { const n = b[1]; p = 2; const w = []; for (let i = 0; i < n; ++i) { [s, p] = read8(b, p); [t, p] = read8(b, p); w.push(s + "=" + t); } return { id, worlds: w }; }
		case 0x69: [s, p] = read8(b, 2); [t] = read8(b, p); return { id, version: b[1], comment: s, brand: t };
		case 0xfe: [s, p] = read8(b, 1); return { id, peer: s, code: b[p] };
		case 0xff: [s] = read16(b, 2); return { id, code: b[1], desc: s };
		default: return { id };
	}
}

function connect(name) {
	const ws = new WebSocket(RELAY);
	ws.binaryType = "arraybuffer";
	const queue = [];
	let waiter = null;
	ws.onmessage = (e) => { const m = parse(e.data); if (waiter) { const w = waiter; waiter = null; w(m); } else queue.push(m); };
	ws.closed = new Promise((r) => (ws.onclose = () => r()));
	ws.next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise((r, j) => { waiter = r; setTimeout(() => j(new Error(name + ": timed out waiting for a packet")), 5000); });
	return new Promise((r, j) => { ws.onopen = () => r(ws); ws.onerror = () => j(new Error(name + ": connect failed")); });
}

let failures = 0;
function check(label, cond, got) {
	console.log((cond ? "ok   " : "FAIL ") + label + (cond ? "" : "  got: " + JSON.stringify(got)));
	if (!cond) ++failures;
}

const host = await connect("host");
host.send(handshake(0x01, "My World;0"));
const hs = await host.next();
check("host gets a 5 char join code", hs.id === 0x00 && hs.type === 1 && /^[a-z0-9]{5}$/.test(hs.code), hs);
const hostIce = await host.next();
check("host gets ICE servers incl. Cloudflare STUN", hostIce.id === 0x01 && hostIce.servers.some((s) => s.includes("stun.cloudflare.com")), hostIce);

const lan = await connect("lan query");
lan.send(handshake(0x04, ""));
const worlds = await lan.next();
check("LAN discovery lists the world", worlds.id === 0x07 && worlds.worlds.includes("My World=" + hs.code), worlds);

const ping = await connect("ping");
ping.send(handshake(0x03, ""));
const pong = await ping.next();
check("relay answers pings", pong.id === 0x69 && pong.version === 1 && pong.brand === "heisenberg", pong);

const bad = await connect("bad code");
bad.send(handshake(0x02, "zzzzz"));
const err = await bad.next();
check("wrong code is rejected", err.id === 0xff && err.code === 0x05, err);

const joiner = await connect("joiner");
joiner.send(handshake(0x02, hs.code.toUpperCase()));
const jhs = await joiner.next();
check("joiner gets a client id", jhs.id === 0x00 && jhs.code.length === 16, jhs);
const jIce = await joiner.next();
check("joiner gets ICE servers", jIce.id === 0x01 && jIce.servers.length >= 1, jIce);
const nc = await host.next();
check("host is told about the joiner", nc.id === 0x02 && nc.peer === jhs.code, nc);

joiner.send(desc("", "client-offer"));
const d1 = await host.next();
check("offer reaches host", d1.id === 0x04 && d1.peer === jhs.code && d1.data === "client-offer", d1);
host.send(desc(jhs.code, "host-answer"));
const d2 = await joiner.next();
check("answer reaches joiner", d2.id === 0x04 && d2.data === "host-answer", d2);
joiner.send(cand("", "client-candidates"));
const c1 = await host.next();
check("joiner ICE reaches host", c1.id === 0x03 && c1.data === "client-candidates", c1);
host.send(cand(jhs.code, "host-candidates"));
const c2 = await joiner.next();
check("host ICE reaches joiner", c2.id === 0x03 && c2.data === "host-candidates", c2);
joiner.send(success(""));
const s1 = await host.next();
check("host is told the join succeeded", s1.id === 0x05 && s1.peer === jhs.code, s1);
const fe = await joiner.next();
check("joiner is released by the relay", fe.id === 0xfe && fe.code === 0x00, fe);
await joiner.closed;
check("joiner socket closed", true);

// a second joiner who is still signaling when the host leaves gets dropped
const j2 = await connect("joiner 2");
j2.send(handshake(0x02, hs.code));
await j2.next(); await j2.next(); await host.next();
host.close();
const drop = await j2.next();
check("host leaving drops pending joiners", drop.id === 0xfe && drop.code === 0x05, drop);

const lan2 = await connect("lan query 2");
lan2.send(handshake(0x04, ""));
const worlds2 = await lan2.next();
check("closed world disappears from discovery", worlds2.id === 0x07 && !worlds2.worlds.some((w) => w.endsWith(hs.code)), worlds2);

console.log(failures ? failures + " check(s) failed" : "all relay checks passed");
process.exit(failures ? 1 : 0);
