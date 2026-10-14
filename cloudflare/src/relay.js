/**
 * LAN world relay for Heisenberg/Eaglercraft as a Durable Object.
 *
 * Port of sp-relay (net.lax1dude.eaglercraft.sp.relay). A player who opens their
 * singleplayer world to LAN connects here as a "server" and gets a join code,
 * friends connect as "clients" with that code, and the relay forwards the WebRTC
 * offer/answer and ICE candidates between them. After that the game traffic goes
 * peer to peer, the relay only does signaling.
 *
 * Uses the WebSocket Hibernation API: all per-connection state lives in the
 * socket attachment and sockets are found again by tag, so the object can be
 * evicted from memory while hosts sit idle with their world open.
 *
 * Wire format: every message is one binary frame, first byte is the packet id.
 * Strings are ASCII with an 8 or 16 bit big endian length prefix.
 */

const PROTOCOL_VERSION = 1;
const VERSION_BRAND = "heisenberg";

const CODE_LENGTH = 5;
const CODE_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const CLIENT_ID_LENGTH = 16;
const CLIENT_ID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const CONNECTIONS_PER_IP = 128;
const WORLDS_PER_IP = 32;

/** a socket must send its handshake within this time */
const PENDING_TIMEOUT_MS = 10000;
/** a joining client must finish signaling within this time */
const CLIENT_TIMEOUT_MS = 30000;

// packet ids
const PKT_HANDSHAKE = 0x00;
const PKT_ICE_SERVERS = 0x01;
const PKT_NEW_CLIENT = 0x02;
const PKT_ICE_CANDIDATE = 0x03;
const PKT_DESCRIPTION = 0x04;
const PKT_CLIENT_SUCCESS = 0x05;
const PKT_CLIENT_FAILURE = 0x06;
const PKT_LOCAL_WORLDS = 0x07;
const PKT_PONG = 0x69;
const PKT_DISCONNECT_CLIENT = 0xfe;
const PKT_ERROR = 0xff;

// IPacketFFErrorCode types
const ERR_INTERNAL = 0x00;
const ERR_PROTOCOL_VERSION = 0x01;
const ERR_INVALID_PACKET = 0x02;
const ERR_ILLEGAL_OPERATION = 0x03;
const ERR_CODE_LENGTH = 0x04;
const ERR_INCORRECT_CODE = 0x05;
const ERR_UNKNOWN_CLIENT = 0x07;

// IPacketFEDisconnectClient types
const DC_FINISHED_SUCCESS = 0x00;
const DC_FINISHED_FAILED = 0x01;
const DC_TIMEOUT = 0x02;
const DC_INVALID_OPERATION = 0x03;
const DC_SERVER_DISCONNECT = 0x05;
const DC_UNKNOWN = 0xff;

const RATELIMIT_TOO_MANY = new Uint8Array([0xfc, 0x00]);

// client signaling states, same order as LoginState.java
const ST_INIT = "INIT";
const ST_SENT_ICE_CANDIDATE = "SENT_ICE_CANDIDATE";
const ST_RECIEVED_ICE_CANDIDATE = "RECIEVED_ICE_CANIDATE";
const ST_SENT_DESCRIPTION = "SENT_DESCRIPTION";
const ST_RECIEVED_DESCRIPTION = "RECIEVED_DESCRIPTION";
const ST_FINISHED = "FINISHED";

class Writer {
	constructor() {
		this.bytes = [];
	}
	u8(v) {
		this.bytes.push(v & 0xff);
		return this;
	}
	u16(v) {
		this.bytes.push((v >> 8) & 0xff, v & 0xff);
		return this;
	}
	ascii(s) {
		for (let i = 0; i < s.length; ++i) this.bytes.push(s.charCodeAt(i) & 0xff);
		return this;
	}
	ascii8(s) {
		if (s == null) return this.u8(0);
		s = s.length > 255 ? s.substring(0, 255) : s;
		return this.u8(s.length).ascii(s);
	}
	ascii16(s) {
		if (s == null) return this.u16(0);
		s = s.length > 65535 ? s.substring(0, 65535) : s;
		return this.u16(s.length).ascii(s);
	}
	build() {
		return new Uint8Array(this.bytes);
	}
}

class Reader {
	constructor(buf) {
		this.b = new Uint8Array(buf);
		this.p = 0;
	}
	u8() {
		if (this.p >= this.b.length) throw new Error("unexpected end of packet");
		return this.b[this.p++];
	}
	ascii(len) {
		if (this.p + len > this.b.length) throw new Error("unexpected end of packet");
		let s = "";
		for (let i = 0; i < len; ++i) s += String.fromCharCode(this.b[this.p++]);
		return s;
	}
	ascii8() {
		return this.ascii(this.u8());
	}
	ascii16() {
		const hi = this.u8();
		const lo = this.u8();
		return this.ascii((hi << 8) | lo);
	}
	end() {
		if (this.p !== this.b.length) throw new Error("packet had " + (this.b.length - this.p) + " remaining bytes");
	}
}

function parsePacket(buf) {
	const r = new Reader(buf);
	const id = r.u8();
	let pkt;
	switch (id) {
		case PKT_HANDSHAKE:
			pkt = { id, type: r.u8(), version: r.u8(), code: r.ascii8() };
			break;
		case PKT_ICE_CANDIDATE:
		case PKT_DESCRIPTION:
			pkt = { id, peerId: r.ascii8(), data: r.ascii16() };
			break;
		case PKT_CLIENT_SUCCESS:
		case PKT_CLIENT_FAILURE:
			pkt = { id, clientId: r.ascii8() };
			break;
		case PKT_DISCONNECT_CLIENT:
			pkt = { id, clientId: r.ascii8(), code: r.u8(), reason: r.ascii16() };
			break;
		default:
			throw new Error("unknown packet type " + id);
	}
	r.end();
	return pkt;
}

const pkt = {
	handshake: (type, version, code) => new Writer().u8(PKT_HANDSHAKE).u8(type).u8(version).ascii8(code).build(),
	iceServers: (servers) => {
		const w = new Writer().u8(PKT_ICE_SERVERS).u16(servers.length);
		for (const s of servers) {
			w.u8(s.turn ? 0x54 /* T */ : 0x53 /* S */).ascii16(s.url).ascii8(s.username || null).ascii8(s.credential || null);
		}
		return w.build();
	},
	newClient: (id) => new Writer().u8(PKT_NEW_CLIENT).ascii8(id).build(),
	iceCandidate: (peerId, c) => new Writer().u8(PKT_ICE_CANDIDATE).ascii8(peerId).ascii16(c).build(),
	description: (peerId, d) => new Writer().u8(PKT_DESCRIPTION).ascii8(peerId).ascii16(d).build(),
	clientSuccess: (id) => new Writer().u8(PKT_CLIENT_SUCCESS).ascii8(id).build(),
	clientFailure: (id) => new Writer().u8(PKT_CLIENT_FAILURE).ascii8(id).build(),
	localWorlds: (worlds) => {
		const w = new Writer().u8(PKT_LOCAL_WORLDS);
		if (worlds == null) return w.u8(0).build();
		const list = worlds.slice(0, 255);
		w.u8(list.length);
		for (const x of list) w.ascii8(x.name).ascii8(x.code);
		return w.build();
	},
	pong: (comment) => new Writer().u8(PKT_PONG).u8(PROTOCOL_VERSION).ascii8(comment).ascii8(VERSION_BRAND).build(),
	disconnectClient: (id, code, reason) => new Writer().u8(PKT_DISCONNECT_CLIENT).ascii8(id).u8(code).ascii16(reason).build(),
	error: (code, desc) => new Writer().u8(PKT_ERROR).u8(code).ascii16(desc).build(),
};

function randomString(len, chars) {
	const bytes = new Uint8Array(len);
	crypto.getRandomValues(bytes);
	let s = "";
	for (let i = 0; i < len; ++i) s += chars[bytes[i] % chars.length];
	return s;
}

function send(ws, data) {
	try {
		ws.send(data);
	} catch (e) {
		// socket already closed
	}
}

function close(ws) {
	try {
		ws.close(1000, "");
	} catch (e) {
		// already closed
	}
}

export class LanRelay {
	constructor(ctx, env) {
		this.ctx = ctx;
		this.env = env;
		this.iceCache = null;
	}

	async fetch(request) {
		if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
			return new Response("Expected a WebSocket upgrade", { status: 426 });
		}
		const addr = (request.headers.get("CF-Connecting-IP") || "unknown").toLowerCase();

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);

		let count = 0;
		for (const ws of this.ctx.getWebSockets()) {
			const a = ws.deserializeAttachment();
			if (a && a.addr === addr && (a.role === "pending" || a.role === "client")) ++count;
		}
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({ role: "pending", addr, t: Date.now() });
		if (count >= CONNECTIONS_PER_IP) {
			send(server, RATELIMIT_TOO_MANY);
			close(server);
		} else {
			await this.scheduleAlarm();
		}
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws, message) {
		if (typeof message === "string") {
			close(ws);
			return;
		}
		const att = ws.deserializeAttachment();
		if (!att) {
			close(ws);
			return;
		}
		let p;
		try {
			p = parsePacket(message);
		} catch (e) {
			send(ws, pkt.error(ERR_INVALID_PACKET, "Invalid Packet Recieved"));
			close(ws);
			return;
		}
		try {
			if (att.role === "pending") {
				await this.handleHandshake(ws, att, p);
			} else if (att.role === "server") {
				this.handleServerPacket(ws, att, p);
			} else if (att.role === "client") {
				this.handleClientPacket(ws, att, p);
			} else {
				close(ws);
			}
		} catch (e) {
			console.error("relay error", e && e.stack ? e.stack : e);
			send(ws, pkt.error(ERR_INTERNAL, "Internal Server Error"));
			close(ws);
		}
	}

	async handleHandshake(ws, att, p) {
		if (p.id !== PKT_HANDSHAKE) {
			send(ws, pkt.error(ERR_ILLEGAL_OPERATION, "Unexpected Init Packet"));
			close(ws);
			return;
		}
		if (p.version !== PROTOCOL_VERSION) {
			send(ws, pkt.error(ERR_PROTOCOL_VERSION, p.version < PROTOCOL_VERSION ?
				"Outdated Client! (v" + PROTOCOL_VERSION + " req)" : "Outdated Server! (still on v" + PROTOCOL_VERSION + ")"));
			close(ws);
			return;
		}

		if (p.type === 0x01) {
			// a player opening their world to LAN
			let worlds = 0;
			for (const s of this.ctx.getWebSockets()) {
				const a = s.deserializeAttachment();
				if (a && a.role === "server" && a.addr === att.addr) ++worlds;
			}
			if (worlds >= WORLDS_PER_IP) {
				send(ws, RATELIMIT_TOO_MANY);
				close(ws);
				return;
			}
			let code = null;
			for (let i = 0; i < 100; ++i) {
				const c = randomString(CODE_LENGTH, CODE_CHARS);
				if (!this.findServer(c)) {
					code = c;
					break;
				}
			}
			if (code == null) {
				send(ws, pkt.error(ERR_INTERNAL, "Internal Server Error"));
				close(ws);
				return;
			}
			let name = p.code || "";
			let hidden = false;
			if (name.endsWith(";1")) {
				hidden = true;
				name = name.substring(0, name.length - 2);
			} else if (name.endsWith(";0")) {
				name = name.substring(0, name.length - 2);
			}
			ws.serializeAttachment({ role: "server", addr: att.addr, code, name, hidden });
			this.indexServer(ws, code);
			send(ws, pkt.handshake(0x01, PROTOCOL_VERSION, code));
			send(ws, pkt.iceServers(await this.getIceServers()));
		} else if (p.type === 0x02) {
			// a player joining a LAN world by code
			let code = p.code || "";
			if (code.length !== CODE_LENGTH) {
				send(ws, pkt.error(ERR_CODE_LENGTH, "The join code is the wrong length, it should be " + CODE_LENGTH + " chars long"));
				close(ws);
				return;
			}
			code = code.toLowerCase();
			const host = this.findServer(code);
			if (!host) {
				send(ws, pkt.error(ERR_INCORRECT_CODE, "Invalid code, no LAN world found!"));
				close(ws);
				return;
			}
			let id;
			do {
				id = randomString(CLIENT_ID_LENGTH, CLIENT_ID_CHARS);
			} while (this.findClient(id));
			ws.serializeAttachment({ role: "client", addr: att.addr, id, code, state: ST_INIT, notified: false, t: Date.now() });
			send(ws, pkt.handshake(0x02, PROTOCOL_VERSION, id));
			send(host, pkt.newClient(id));
			send(ws, pkt.iceServers(await this.getIceServers()));
		} else if (p.type === 0x03) {
			// relay ping from the network settings screen
			send(ws, pkt.pong(this.env.RELAY_COMMENT || "Heisenberg relay on Cloudflare"));
			close(ws);
		} else if (p.type === 0x04) {
			// LAN worlds hosted from the same public IP, shown on the multiplayer screen
			const worlds = [];
			for (const s of this.ctx.getWebSockets()) {
				const a = s.deserializeAttachment();
				if (a && a.role === "server" && !a.hidden && a.addr === att.addr) {
					worlds.push({ name: a.name, code: a.code });
				}
			}
			send(ws, pkt.localWorlds(worlds));
			close(ws);
		} else {
			send(ws, pkt.error(ERR_ILLEGAL_OPERATION, "Unexpected Init Packet"));
			close(ws);
		}
	}

	handleServerPacket(ws, att, p) {
		if (p.id === PKT_ICE_CANDIDATE || p.id === PKT_DESCRIPTION || p.id === PKT_DISCONNECT_CLIENT) {
			const peerId = p.id === PKT_DISCONNECT_CLIENT ? p.clientId : p.peerId;
			const cws = this.findClient(peerId);
			const ca = cws ? cws.deserializeAttachment() : null;
			if (!ca || ca.code !== att.code) {
				send(ws, pkt.error(ERR_UNKNOWN_CLIENT, "Unknown Client ID: " + peerId));
				return;
			}
			if (p.id === PKT_ICE_CANDIDATE) {
				if (this.expectState(cws, ca, ST_SENT_ICE_CANDIDATE)) {
					ca.state = ST_RECIEVED_ICE_CANDIDATE;
					cws.serializeAttachment(ca);
					send(cws, pkt.iceCandidate("", p.data));
				}
			} else if (p.id === PKT_DESCRIPTION) {
				if (this.expectState(cws, ca, ST_SENT_DESCRIPTION)) {
					ca.state = ST_RECIEVED_DESCRIPTION;
					cws.serializeAttachment(ca);
					send(cws, pkt.description("", p.data));
				}
			} else {
				this.disconnectClient(cws, ca, p.code, p.reason);
			}
		} else {
			send(ws, pkt.error(ERR_INVALID_PACKET, "Invalid Packet Recieved"));
			close(ws);
		}
	}

	handleClientPacket(ws, att, p) {
		const host = this.findServer(att.code);
		if (!host) {
			this.disconnectClient(ws, att, DC_SERVER_DISCONNECT, "Server disconnected");
			return;
		}
		if (p.id === PKT_DESCRIPTION) {
			if (this.expectState(ws, att, ST_INIT)) {
				att.state = ST_SENT_DESCRIPTION;
				ws.serializeAttachment(att);
				send(host, pkt.description(att.id, p.data));
			}
		} else if (p.id === PKT_ICE_CANDIDATE) {
			if (this.expectState(ws, att, ST_RECIEVED_DESCRIPTION)) {
				att.state = ST_SENT_ICE_CANDIDATE;
				ws.serializeAttachment(att);
				send(host, pkt.iceCandidate(att.id, p.data));
			}
		} else if (p.id === PKT_CLIENT_SUCCESS || p.id === PKT_CLIENT_FAILURE) {
			if (this.expectState(ws, att, ST_RECIEVED_ICE_CANDIDATE)) {
				att.state = ST_FINISHED;
				ws.serializeAttachment(att);
				const ok = p.id === PKT_CLIENT_SUCCESS;
				send(host, ok ? pkt.clientSuccess(att.id) : pkt.clientFailure(att.id));
				this.disconnectClient(ws, att, ok ? DC_FINISHED_SUCCESS : DC_FINISHED_FAILED, ok ? "Successful connection" : "Failed connection");
			}
		} else {
			send(ws, pkt.error(ERR_INVALID_PACKET, "Invalid Packet Recieved"));
			close(ws);
		}
	}

	expectState(ws, att, state) {
		if (att.state !== state) {
			this.disconnectClient(ws, att, DC_INVALID_OPERATION, "client is in state " + att.state + " when it was supposed to be " + state);
			return false;
		}
		return true;
	}

	/** EaglerSPClient.disconnect: tell the host (unless it succeeded) and the client, then close */
	disconnectClient(ws, att, code, reason) {
		const msg = pkt.disconnectClient(att.id, code, reason);
		if (!att.notified) {
			att.notified = true;
			ws.serializeAttachment(att);
			if (code !== DC_FINISHED_SUCCESS) {
				const host = this.findServer(att.code);
				if (host) send(host, msg);
			}
		}
		send(ws, msg);
		close(ws);
	}

	// in-memory indexes, rebuilt from socket attachments after hibernation
	indexServer(ws, code) {
		this.ensureIndex();
		this.servers.set(code, ws);
	}

	ensureIndex() {
		if (this.servers) return;
		this.servers = new Map();
		this.clients = new Map();
		for (const s of this.ctx.getWebSockets()) {
			const a = s.deserializeAttachment();
			if (!a) continue;
			if (a.role === "server") this.servers.set(a.code, s);
			else if (a.role === "client") this.clients.set(a.id, s);
		}
	}

	findServer(code) {
		this.ensureIndex();
		const ws = this.servers.get(code);
		if (ws) {
			const a = ws.deserializeAttachment();
			if (a && a.role === "server" && a.code === code) return ws;
			this.servers.delete(code);
		}
		return null;
	}

	findClient(id) {
		this.ensureIndex();
		let ws = this.clients.get(id);
		if (!ws) {
			// clients are indexed lazily, a new one may not be in the map yet
			for (const s of this.ctx.getWebSockets()) {
				const a = s.deserializeAttachment();
				if (a && a.role === "client" && a.id === id) {
					ws = s;
					this.clients.set(id, s);
					break;
				}
			}
		}
		if (ws) {
			const a = ws.deserializeAttachment();
			if (a && a.role === "client" && a.id === id) return ws;
			this.clients.delete(id);
		}
		return null;
	}

	async webSocketClose(ws) {
		this.onSocketGone(ws);
	}

	async webSocketError(ws) {
		this.onSocketGone(ws);
	}

	onSocketGone(ws) {
		const att = ws.deserializeAttachment();
		if (!att) return;
		ws.serializeAttachment(null);
		this.ensureIndex();
		if (att.role === "server") {
			this.servers.delete(att.code);
			// the world closed, drop everyone still signaling with it
			for (const s of this.ctx.getWebSockets()) {
				const a = s.deserializeAttachment();
				if (a && a.role === "client" && a.code === att.code) {
					a.notified = true;
					s.serializeAttachment(a);
					send(s, pkt.disconnectClient(a.id, DC_SERVER_DISCONNECT, "Server disconnected"));
					close(s);
				}
			}
		} else if (att.role === "client") {
			this.clients.delete(att.id);
			if (!att.notified) {
				const host = this.findServer(att.code);
				if (host) send(host, pkt.disconnectClient(att.id, DC_UNKNOWN, "End of stream"));
			}
		}
	}

	async scheduleAlarm() {
		const current = await this.ctx.storage.getAlarm();
		if (current == null) {
			await this.ctx.storage.setAlarm(Date.now() + 5000);
		}
	}

	/** closes sockets that never handshook and clients that stall mid-signaling */
	async alarm() {
		const now = Date.now();
		let waiting = false;
		for (const ws of this.ctx.getWebSockets()) {
			const a = ws.deserializeAttachment();
			if (!a) continue;
			if (a.role === "pending") {
				if (now - a.t > PENDING_TIMEOUT_MS) close(ws);
				else waiting = true;
			} else if (a.role === "client" && a.state !== ST_FINISHED) {
				if (now - a.t > CLIENT_TIMEOUT_MS) this.disconnectClient(ws, a, DC_TIMEOUT, "Took too long to connect");
				else waiting = true;
			}
		}
		if (waiting) {
			await this.ctx.storage.setAlarm(Date.now() + 5000);
		}
	}

	/**
	 * Cloudflare's public STUN is always offered. With TURN_KEY_ID and
	 * TURN_KEY_API_TOKEN set, short lived Cloudflare TURN credentials are added
	 * so players behind strict NATs or firewalls can still connect.
	 */
	async getIceServers() {
		const servers = [
			{ url: "stun:stun.cloudflare.com:3478" },
			{ url: "stun:stun.l.google.com:19302" },
		];
		if (!this.env.TURN_KEY_ID || !this.env.TURN_KEY_API_TOKEN) {
			return servers;
		}
		const now = Date.now();
		if (!this.iceCache || this.iceCache.expires < now) {
			try {
				const res = await fetch("https://rtc.live.cloudflare.com/v1/turn/keys/" + this.env.TURN_KEY_ID + "/credentials/generate-ice-servers", {
					method: "POST",
					headers: { Authorization: "Bearer " + this.env.TURN_KEY_API_TOKEN, "Content-Type": "application/json" },
					body: JSON.stringify({ ttl: 86400 }),
				});
				if (!res.ok) throw new Error("TURN credential request failed: " + res.status);
				const body = await res.json();
				const list = Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];
				const turn = [];
				for (const entry of list) {
					if (!entry) continue;
					const urls = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
					for (const url of urls) {
						// browsers time out on port 53, Cloudflare recommends skipping it
						if (!url || !url.startsWith("turn") || /:53(\?|$)/.test(url)) continue;
						turn.push({ url, turn: true, username: entry.username, credential: entry.credential });
					}
				}
				// refresh well before the 24h credentials expire
				this.iceCache = { servers: turn, expires: now + 12 * 3600 * 1000 };
			} catch (e) {
				console.error("TURN credentials unavailable", e && e.message ? e.message : e);
				this.iceCache = { servers: [], expires: now + 60 * 1000 };
			}
		}
		return servers.concat(this.iceCache.servers);
	}
}
