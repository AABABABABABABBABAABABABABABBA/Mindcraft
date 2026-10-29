/*
 * Heisenberg touch controls, Pocket Edition style.
 *
 * Loaded from the asset pack by EaglerAdapter.installTouchControls(). Shows up
 * on the first touch and turns touches into the keyboard and mouse events the
 * game already understands:
 *
 *   in a world:  D-pad = WASD (double tap up to sprint), center = sneak toggle,
 *                jump button = space, drag anywhere = look around,
 *                tap = use / place, hold = break / attack, tap hotbar = select slot,
 *                buttons for inventory (E), chat (T), pause (Esc), camera (F5), drop (Q)
 *   in menus:    touches act as mouse clicks and drags, keyboard button for typing
 *
 * The game publishes window.__hbState every frame: grabbed (in world, mouse
 * captured) and the hotbar rectangle in CSS pixels.
 */
(function () {
	if (window.__hbTouchInstalled) return;
	window.__hbTouchInstalled = true;

	var LOOK_SENSITIVITY = 2.2;
	var HOLD_MS = 280;
	var TAP_SLOP = 10;

	var canvas = document.querySelector("canvas");
	if (!canvas) return;

	// stop the page itself from scrolling, zooming or selecting text
	var meta = document.querySelector("meta[name=viewport]");
	if (!meta) {
		meta = document.createElement("meta");
		meta.name = "viewport";
		document.head.appendChild(meta);
	}
	meta.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";

	var css = document.createElement("style");
	css.textContent =
		"html,body{touch-action:none;overscroll-behavior:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;}" +
		"canvas{touch-action:none;}" +
		"#hb-touch{position:fixed;inset:0;pointer-events:none;z-index:10;display:none;font-family:sans-serif;}" +
		"#hb-touch.on{display:block;}" +
		"#hb-touch .b{position:absolute;pointer-events:auto;box-sizing:border-box;display:flex;align-items:center;justify-content:center;" +
		"background:rgba(40,40,40,.45);border:2px solid rgba(255,255,255,.35);border-radius:10px;color:#fff;font-weight:bold;text-shadow:0 1px 2px #000;}" +
		"#hb-touch .b.down{background:rgba(255,255,255,.35);}" +
		"#hb-touch .w{display:none;}#hb-touch.world .w{display:flex;}" +
		"#hb-touch .m{display:none;}#hb-touch.menu .m{display:flex;}" +
		"#hb-kbd{position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;}";
	document.head.appendChild(css);

	// ---- event injection --------------------------------------------------

	function key(code, name, down) {
		var e = new KeyboardEvent(down ? "keydown" : "keyup", { key: name, bubbles: true, cancelable: true });
		Object.defineProperty(e, "which", { get: function () { return code; } });
		Object.defineProperty(e, "keyCode", { get: function () { return code; } });
		window.dispatchEvent(e);
	}
	function tapKey(code, name) {
		key(code, name, true);
		setTimeout(function () { key(code, name, false); }, 60);
	}
	var lastX = 0, lastY = 0;
	function mouse(type, button, x, y, mx, my) {
		lastX = x; lastY = y;
		canvas.dispatchEvent(new MouseEvent(type, {
			bubbles: true, cancelable: true, button: button || 0,
			clientX: x, clientY: y, movementX: mx || 0, movementY: my || 0
		}));
	}

	function state() { return window.__hbState || {}; }
	function inWorld() { return !!state().grabbed; }

	// ---- overlay ------------------------------------------------------------

	var root = document.createElement("div");
	root.id = "hb-touch";
	document.body.appendChild(root);

	var kbd = document.createElement("input");
	kbd.id = "hb-kbd";
	kbd.type = "text";
	kbd.setAttribute("data-hb-ignore", "1");
	kbd.setAttribute("autocomplete", "off");
	kbd.setAttribute("autocorrect", "off");
	kbd.setAttribute("autocapitalize", "off");
	kbd.setAttribute("spellcheck", "false");
	document.body.appendChild(kbd);

	function button(label, cls, onDown, onUp) {
		var el = document.createElement("div");
		el.className = "b " + cls;
		el.textContent = label;
		el.addEventListener("touchstart", function (e) {
			e.preventDefault(); e.stopPropagation();
			el.classList.add("down");
			if (onDown) onDown(e);
		}, { passive: false });
		var up = function (e) {
			e.preventDefault(); e.stopPropagation();
			el.classList.remove("down");
			if (onUp) onUp(e);
		};
		el.addEventListener("touchend", up, { passive: false });
		el.addEventListener("touchcancel", up, { passive: false });
		root.appendChild(el);
		return el;
	}

	// D-pad: one region so a thumb can slide between directions and diagonals,
	// tapping the middle toggles sneak
	var dpad = document.createElement("div");
	dpad.className = "b w";
	dpad.style.background = "transparent";
	dpad.style.border = "0";
	root.appendChild(dpad);
	var arrows = {};
	["up", "left", "right", "down"].forEach(function (d) {
		var a = document.createElement("div");
		a.className = "b";
		a.style.pointerEvents = "none";
		a.textContent = { up: "▲", down: "▼", left: "◀", right: "▶" }[d];
		dpad.appendChild(a);
		arrows[d] = a;
	});
	var sneakEl = document.createElement("div");
	sneakEl.className = "b";
	sneakEl.style.pointerEvents = "none";
	sneakEl.style.borderRadius = "50%";
	sneakEl.textContent = "●";
	dpad.appendChild(sneakEl);

	var moveKeys = { up: [87, "w"], down: [83, "s"], left: [65, "a"], right: [68, "d"] };
	var held = { up: false, down: false, left: false, right: false };
	var dpadTouch = null, dpadStart = null, sneaking = false;

	function setDir(dir, on) {
		if (held[dir] === on) return;
		held[dir] = on;
		key(moveKeys[dir][0], moveKeys[dir][1], on);
		arrows[dir].classList.toggle("down", on);
	}
	function releaseDpad() {
		setDir("up", false); setDir("down", false); setDir("left", false); setDir("right", false);
	}
	function dpadUpdate(t) {
		var r = dpad.getBoundingClientRect();
		var dx = (t.clientX - (r.left + r.width / 2)) / (r.width / 2);
		var dy = (t.clientY - (r.top + r.height / 2)) / (r.height / 2);
		var dead = 0.3;
		setDir("up", dy < -dead);
		setDir("down", dy > dead);
		setDir("left", dx < -dead);
		setDir("right", dx > dead);
	}
	dpad.addEventListener("touchstart", function (e) {
		e.preventDefault(); e.stopPropagation();
		var t = e.changedTouches[0];
		dpadTouch = t.identifier;
		dpadStart = { x: t.clientX, y: t.clientY, time: Date.now() };
		dpadUpdate(t);
	}, { passive: false });
	dpad.addEventListener("touchmove", function (e) {
		e.preventDefault(); e.stopPropagation();
		for (var i = 0; i < e.changedTouches.length; ++i) {
			if (e.changedTouches[i].identifier === dpadTouch) dpadUpdate(e.changedTouches[i]);
		}
	}, { passive: false });
	var dpadEnd = function (e) {
		e.preventDefault(); e.stopPropagation();
		for (var i = 0; i < e.changedTouches.length; ++i) {
			var t = e.changedTouches[i];
			if (t.identifier !== dpadTouch) continue;
			var wasMoving = held.up || held.down || held.left || held.right;
			releaseDpad();
			dpadTouch = null;
			var r = dpad.getBoundingClientRect();
			var cx = Math.abs(t.clientX - (r.left + r.width / 2)) < r.width / 6;
			var cy = Math.abs(t.clientY - (r.top + r.height / 2)) < r.height / 6;
			if (cx && cy && Date.now() - dpadStart.time < 400 && !wasMoving) {
				sneaking = !sneaking;
				key(16, "Shift", sneaking);
				sneakEl.classList.toggle("down", sneaking);
			}
		}
	};
	dpad.addEventListener("touchend", dpadEnd, { passive: false });
	dpad.addEventListener("touchcancel", dpadEnd, { passive: false });

	var jumpEl = button("⬆", "w", function () { key(32, " ", true); }, function () { key(32, " ", false); });
	jumpEl.style.borderRadius = "50%";

	var invEl = button("⋯", "w", function () { tapKey(69, "e"); });
	var dropEl = button("Q", "w", function () { tapKey(81, "q"); });
	var camEl = button("↻", "w", function () { tapKey(116, "F5"); });
	var chatEl = button("💬", "w", function () {
		tapKey(84, "t");
		// the tap is a user gesture, so the on-screen keyboard is allowed to open
		setTimeout(function () { kbd.focus(); }, 0);
	});
	var pauseEl = button("❚❚", "w m", function () { blurKbd(); tapKey(27, "Escape"); });
	var kbdEl = button("⌨", "m", function () {
		if (document.activeElement === kbd) blurKbd(); else kbd.focus();
	});

	function blurKbd() { kbd.blur(); kbd.value = ""; }

	// ---- typing through the phone keyboard ---------------------------------

	function typeChar(c) {
		var code = c.toUpperCase().charCodeAt(0);
		if (!((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || code === 32)) code = 0;
		key(code, c, true);
		key(code, c, false);
	}
	kbd.addEventListener("beforeinput", function (e) {
		if (e.inputType === "deleteContentBackward") {
			e.preventDefault();
			key(8, "Backspace", true); key(8, "Backspace", false);
		} else if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") {
			e.preventDefault();
			key(13, "Enter", true); key(13, "Enter", false);
		}
	});
	kbd.addEventListener("input", function () {
		var v = kbd.value;
		kbd.value = "";
		for (var i = 0; i < v.length; ++i) typeChar(v.charAt(i));
	});
	kbd.addEventListener("keydown", function (e) {
		if (e.key === "Enter") { e.preventDefault(); key(13, "Enter", true); key(13, "Enter", false); }
		else if (e.key === "Backspace" && !kbd.value) { e.preventDefault(); key(8, "Backspace", true); key(8, "Backspace", false); }
	});

	// ---- layout -------------------------------------------------------------

	function place(el, x, y, w, h) {
		el.style.left = x + "px"; el.style.top = y + "px";
		el.style.width = w + "px"; el.style.height = h + "px";
	}
	function layout() {
		var vw = window.innerWidth, vh = window.innerHeight;
		var s = Math.max(44, Math.min(80, Math.min(vw, vh) * 0.12));
		var m = Math.max(12, s * 0.25);
		var fs = Math.round(s * 0.42) + "px";
		root.querySelectorAll(".b").forEach(function (el) { el.style.fontSize = fs; });

		place(dpad, m, vh - m - s * 3, s * 3, s * 3);
		place(arrows.up, s, 0, s, s);
		place(arrows.left, 0, s, s, s);
		place(arrows.right, s * 2, s, s, s);
		place(arrows.down, s, s * 2, s, s);
		place(sneakEl, s * 1.15, s * 1.15, s * 0.7, s * 0.7);

		place(jumpEl, vw - m - s * 1.4, vh - m - s * 1.4 - s * 0.6, s * 1.4, s * 1.4);

		var t = m * 0.6, small = s * 0.8;
		var world = inWorld();
		// in a world they sit top-right; in menus bottom-right, clear of the menu links at the top
		var by = world ? t : vh - t - small;
		place(pauseEl, vw - t - small, by, small, small);
		place(chatEl, vw - t * 2 - small * 2, t, small, small);
		place(camEl, vw - t * 3 - small * 3, t, small, small);
		place(kbdEl, vw - t * 2 - small * 2, by, small, small);

		var st = state();
		if (st.hw > 0) {
			var hs = Math.max(small * 0.8, st.hh);
			place(invEl, st.hx + st.hw + 6, st.hy + st.hh - hs, hs, hs);
			place(dropEl, st.hx - 6 - hs, st.hy + st.hh - hs, hs, hs);
		}
	}
	window.addEventListener("resize", layout);

	// ---- touches on the game itself ------------------------------------------

	var look = null; // { id, x, y, start, moved, holding, timer }

	function inHotbar(x, y) {
		var st = state();
		return st.hw > 0 && x >= st.hx && x <= st.hx + st.hw && y >= st.hy && y <= st.hy + st.hh;
	}

	canvas.addEventListener("touchstart", function (e) {
		e.preventDefault();
		show();
		for (var i = 0; i < e.changedTouches.length; ++i) {
			var t = e.changedTouches[i];
			if (!inWorld()) {
				// menus: behave like a mouse
				if (look) continue;
				look = { id: t.identifier, x: t.clientX, y: t.clientY, menu: true };
				mouse("mousemove", 0, t.clientX, t.clientY);
				mouse("mousedown", 0, t.clientX, t.clientY);
				continue;
			}
			if (inHotbar(t.clientX, t.clientY)) {
				var st = state();
				var slot = Math.max(0, Math.min(8, Math.floor((t.clientX - st.hx) / (st.hw / 9))));
				tapKey(49 + slot, String(slot + 1));
				continue;
			}
			if (look) continue;
			look = { id: t.identifier, x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, start: Date.now(), moved: false, holding: false };
			var cur = look;
			cur.timer = setTimeout(function () {
				if (look === cur && !cur.moved) {
					cur.holding = true;
					mouse("mousedown", 0, lastX, lastY);
				}
			}, HOLD_MS);
		}
	}, { passive: false });

	canvas.addEventListener("touchmove", function (e) {
		e.preventDefault();
		for (var i = 0; i < e.changedTouches.length; ++i) {
			var t = e.changedTouches[i];
			if (!look || t.identifier !== look.id) continue;
			var dx = t.clientX - look.x, dy = t.clientY - look.y;
			look.x = t.clientX; look.y = t.clientY;
			if (look.menu) {
				mouse("mousemove", 0, t.clientX, t.clientY, dx, dy);
				continue;
			}
			if (Math.abs(t.clientX - look.sx) > TAP_SLOP || Math.abs(t.clientY - look.sy) > TAP_SLOP) look.moved = true;
			mouse("mousemove", 0, lastX, lastY, dx * LOOK_SENSITIVITY, dy * LOOK_SENSITIVITY);
		}
	}, { passive: false });

	var touchEnd = function (e) {
		e.preventDefault();
		for (var i = 0; i < e.changedTouches.length; ++i) {
			var t = e.changedTouches[i];
			if (!look || t.identifier !== look.id) continue;
			var l = look;
			look = null;
			if (l.menu) {
				mouse("mouseup", 0, t.clientX, t.clientY);
				continue;
			}
			clearTimeout(l.timer);
			if (l.holding) {
				mouse("mouseup", 0, lastX, lastY);
			} else if (!l.moved && Date.now() - l.start < HOLD_MS) {
				// quick tap: use the held item / place a block
				mouse("mousedown", 2, lastX, lastY);
				setTimeout(function () { mouse("mouseup", 2, lastX, lastY); }, 80);
			}
		}
	};
	canvas.addEventListener("touchend", touchEnd, { passive: false });
	canvas.addEventListener("touchcancel", touchEnd, { passive: false });

	// ---- visibility ------------------------------------------------------------

	var shown = false;
	function show() {
		if (shown) return;
		shown = true;
		root.classList.add("on");
		layout();
	}
	window.addEventListener("touchstart", show, { passive: true, capture: true });
	// a real keyboard means the player doesn't need the buttons
	window.addEventListener("keydown", function (e) {
		if (e.isTrusted && e.target !== kbd && shown) {
			shown = false;
			root.classList.remove("on");
			releaseDpad();
		}
	}, true);

	var lastWorld = null, lastHotbar = "";
	(function tick() {
		var w = inWorld();
		if (w !== lastWorld) {
			lastWorld = w;
			root.classList.toggle("world", w);
			root.classList.toggle("menu", !w);
			if (shown) layout();
			if (w) {
				blurKbd();
			} else {
				releaseDpad();
				if (look && !look.menu) { clearTimeout(look.timer); if (look.holding) mouse("mouseup", 0, lastX, lastY); look = null; }
			}
		}
		var st = state();
		var hb = st.hx + "," + st.hy + "," + st.hw;
		if (hb !== lastHotbar) { lastHotbar = hb; if (shown) layout(); }
		requestAnimationFrame(tick);
	})();
})();
