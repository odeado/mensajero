// Juegos en tiempo real (UI + Firestore)
import {
  collection, doc, setDoc, onSnapshot, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {
  GAMES, newState, applyMove, isMyTurn, gatoWinLine, cuatroFindWin, C4_ROWS, C4_COLS,
  damasLegalMoves, damasCount, RPS, RPS_TARGET, jengaLevels, jengaCanTake, jengaZone
} from "./games-logic.js";

let ctx = null;          // { db, me(), partner(), toast, notify, sendInvite }
let unsub = null;
let currentId = null;
let game = null;         // datos del documento
let selected = -1;       // damas: casilla seleccionada
let busy = false;
let wasMyTurn = null;
let joining = false;

const STATE_KEYS = ["turn", "winner", "moves", "last", "board", "chain", "picks", "score", "round", "fallen"];
let jPick = null;        // jenga: { level, pos, center, width }
let jAnim = null;        // requestAnimationFrame id
let jLastAnimated = "";  // para no repetir la animación del bloque puesto

// ---------- DOM ----------
const menu = el("div", "game-overlay hidden");
menu.innerHTML = `
  <div class="game-card">
    <div class="game-head">
      <h3>🎮 Juegos</h3>
      <button class="icon-btn game-close" title="Cerrar"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <p class="game-sub">Elige un juego para invitar</p>
    <div class="game-list"></div>
  </div>`;
const modal = el("div", "game-overlay hidden");
modal.innerHTML = `
  <div class="game-card game-play">
    <div class="game-head">
      <h3 class="g-title"></h3>
      <button class="icon-btn game-close" title="Cerrar"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="g-players"></div>
    <div class="g-status"></div>
    <div class="g-board"></div>
    <div class="g-extra"></div>
    <div class="g-foot"></div>
  </div>`;
document.body.append(menu, modal);

const $m = (s) => modal.querySelector(s);
menu.querySelector(".game-close").addEventListener("click", () => menu.classList.add("hidden"));
menu.addEventListener("click", (e) => { if (e.target === menu) menu.classList.add("hidden"); });
$m(".game-close").addEventListener("click", closeGame);

Object.entries(GAMES).forEach(([type, g]) => {
  const b = el("button", "game-option");
  b.type = "button";
  const ic = el("span", "go-icon"); ic.textContent = g.icon;
  const tx = el("span", "go-text");
  const n = el("strong"); n.textContent = g.name;
  const d = el("small"); d.textContent = g.desc;
  tx.append(n, d);
  b.append(ic, tx);
  b.addEventListener("click", async () => {
    menu.classList.add("hidden");
    await createGame(type);
  });
  menu.querySelector(".game-list").appendChild(b);
});

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

// ---------- API ----------
export function initGames(c) { ctx = c; }

export function openGamesMenu() { menu.classList.remove("hidden"); }

export async function createGame(type) {
  const me = ctx.me();
  const ref = doc(collection(ctx.db, "games"));
  setDoc(ref, {
    type,
    players: [me.uid, null],
    ...newState(type),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }).catch((e) => { console.error(e); ctx.toast("No se pudo crear el juego."); });
  ctx.sendInvite(type, ref.id);
  openGame(ref.id);
}

export function openGame(id) {
  closeGame();
  currentId = id;
  selected = -1;
  jengaReset();
  wasMyTurn = null;
  game = null;
  $m(".g-title").textContent = "Cargando…";
  $m(".g-board").innerHTML = "";
  $m(".g-status").textContent = "";
  $m(".g-players").textContent = "";
  $m(".g-foot").innerHTML = "";
  modal.classList.remove("hidden");

  unsub = onSnapshot(doc(ctx.db, "games", id), (snap) => {
    if (!snap.exists()) {
      if (!snap.metadata.fromCache) $m(".g-status").textContent = "Este juego ya no existe.";
      return;
    }
    game = snap.data();
    const pi = myIndex();
    // Me uno automáticamente si soy el segundo jugador
    if (!joining && game.players[1] === null && game.players[0] !== ctx.me().uid && !snap.metadata.hasPendingWrites) {
      joining = true;
      join().finally(() => { joining = false; });
    }
    const mine = pi >= 0 && isMyTurn(game.type, game, pi);
    if (wasMyTurn === false && mine && !snap.metadata.hasPendingWrites) {
      ctx.notify(`${ctx.partner().name} jugó`, `Te toca en ${GAMES[game.type].name}`, "game");
    }
    wasMyTurn = mine;
    render();
  }, (err) => {
    console.error(err);
    $m(".g-status").textContent = "No se pudo cargar el juego.";
  });
}

export function closeGame() {
  unsub?.(); unsub = null;
  jengaReset();
  currentId = null;
  modal.classList.add("hidden");
}

// ---------- Jugadas ----------
function myIndex() {
  const me = ctx.me();
  if (!game || !me) return -1;
  const i = game.players.indexOf(me.uid);
  if (i >= 0) return i;
  return game.players[1] === null ? 1 : -1; // aún no se une, pero será el jugador 1
}

async function join() {
  const ref = doc(ctx.db, "games", currentId);
  const uid = ctx.me().uid;
  try {
    await runTransaction(ctx.db, async (tx) => {
      const s = await tx.get(ref);
      const g = s.data();
      if (g.players[1] === null && g.players[0] !== uid) {
        tx.update(ref, { players: [g.players[0], uid] });
      }
    });
  } catch (e) { console.warn(e); }
}

async function play(move) {
  if (busy || !currentId) return;
  busy = true;
  const ref = doc(ctx.db, "games", currentId);
  const uid = ctx.me().uid;
  try {
    await runTransaction(ctx.db, async (tx) => {
      const s = await tx.get(ref);
      const g = s.data();
      let players = g.players;
      let pi = players.indexOf(uid);
      if (pi < 0 && players[1] === null) { players = [players[0], uid]; pi = 1; }
      if (pi < 0) throw new Error("No eres jugador de esta partida");
      const st = {};
      STATE_KEYS.forEach((k) => { if (g[k] !== undefined) st[k] = g[k]; });
      const next = applyMove(g.type, st, pi, move);
      if (!next) throw new Error("Jugada no válida");
      tx.update(ref, { ...next, players, updatedAt: serverTimestamp() });
    });
    selected = -1;
  } catch (e) {
    console.warn(e);
    if (!navigator.onLine) ctx.toast("Sin conexión: la jugada no se envió.");
    else if (e.message !== "Jugada no válida") ctx.toast("No se pudo enviar la jugada.");
  } finally {
    busy = false;
  }
}

// ---------- Render ----------
function nameOf(i) {
  const pi = myIndex();
  return i === pi ? "Tú" : ctx.partner().name;
}

function render() {
  if (!game) return;
  const type = game.type;
  const info = GAMES[type];
  const pi = myIndex();
  $m(".g-title").textContent = `${info.icon} ${info.name}`;

  // Jugadores / fichas
  const marks = {
    gato: ["❌", "⭕"], cuatro: ["🔴", "🟡"], damas: ["⚪", "🔴"], cachipun: ["", ""], jenga: ["", ""]
  }[type];
  if (type === "jenga") {
    $m(".g-players").textContent = `Pisos: ${jengaLevels(game.board)}   ·   Bloques sacados: ${game.moves}`;
  } else if (type === "cachipun") {
    $m(".g-players").textContent =
      `${nameOf(0)} ${game.score[0]} – ${game.score[1]} ${nameOf(1)}   ·   gana el primero a ${RPS_TARGET}`;
  } else {
    $m(".g-players").textContent = `${nameOf(0)}: ${marks[0]}    ${nameOf(1)}: ${marks[1]}`;
  }

  // Estado
  const st = $m(".g-status");
  st.className = "g-status";
  if (game.winner === "draw") st.textContent = "🤝 ¡Empate!";
  else if (game.winner !== null && game.winner !== undefined) {
    const iWon = game.winner === pi;
    if (type === "jenga") st.textContent = iWon ? `💥 ¡${ctx.partner().name} botó la torre! Ganaste 🎉` : "💥 ¡Se te cayó la torre!";
    else st.textContent = iWon ? "🎉 ¡Ganaste!" : `🏆 Ganó ${ctx.partner().name}`;
    st.classList.add(iWon ? "win" : "lose");
  } else if (type === "cachipun") {
    const mine = game.picks?.[pi];
    const other = game.picks?.[1 - pi];
    st.textContent = mine
      ? `Elegiste ${RPS[mine].icon}. Esperando a ${ctx.partner().name}…`
      : other ? `${ctx.partner().name} ya eligió 🤫 ¡Te toca!` : `Ronda ${game.round}: ¡elige!`;
    if (!mine) st.classList.add("turn");
  } else if (isMyTurn(type, game, pi)) {
    st.textContent = type === "damas" && game.chain >= 0 ? "¡Sigue comiendo!" : "¡Tu turno!";
    st.classList.add("turn");
  } else {
    st.textContent = `Turno de ${ctx.partner().name}…`;
  }

  $m(".g-extra").textContent = "";
  const board = $m(".g-board");
  board.innerHTML = "";
  board.className = `g-board g-${type}`;
  ({ gato: renderGato, cuatro: renderCuatro, damas: renderDamas, cachipun: renderCachipun, jenga: renderJenga })[type](board, pi);

  // Pie
  const foot = $m(".g-foot");
  foot.innerHTML = "";
  if (game.winner !== null && game.winner !== undefined) {
    const again = el("button", "g-btn");
    again.textContent = "🔁 Revancha";
    again.addEventListener("click", () => createGame(type));
    foot.appendChild(again);
  }
}

function renderGato(board, pi) {
  const line = gatoWinLine(game.board) || [];
  const can = isMyTurn("gato", game, pi);
  [...game.board].forEach((ch, i) => {
    const b = el("button", "cell");
    b.textContent = ch === "X" ? "❌" : ch === "O" ? "⭕" : "";
    if (line.includes(i)) b.classList.add("win");
    if (game.last === i) b.classList.add("last");
    b.disabled = !can || ch !== ".";
    b.addEventListener("click", () => play({ cell: i }));
    board.appendChild(b);
  });
}

function renderCuatro(board, pi) {
  const line = cuatroFindWin(game.board) || [];
  const can = isMyTurn("cuatro", game, pi);
  for (let r = 0; r < C4_ROWS; r++) for (let c = 0; c < C4_COLS; c++) {
    const i = r * C4_COLS + c;
    const ch = game.board[i];
    const cell = el("button", "c4-cell");
    const disc = el("span", "disc" + (ch === "R" ? " red" : ch === "A" ? " yellow" : ""));
    if (line.includes(i)) disc.classList.add("win");
    if (game.last === i) disc.classList.add("drop");
    cell.appendChild(disc);
    cell.disabled = !can || game.board[c] !== ".";
    cell.addEventListener("click", () => play({ col: c }));
    board.appendChild(cell);
  }
}

function renderDamas(board, pi) {
  const flip = pi === 1;
  const my = isMyTurn("damas", game, pi);
  const moves = my ? damasLegalMoves(game, pi) : [];
  if (my && game.chain >= 0) selected = game.chain;
  const movable = new Set(moves.map((m) => m.from));
  if (!movable.has(selected)) selected = -1;
  const targets = new Set(moves.filter((m) => m.from === selected).map((m) => m.to));
  const last = game.last && typeof game.last === "object" ? game.last : null;

  for (let dr = 0; dr < 8; dr++) for (let dc = 0; dc < 8; dc++) {
    const r = flip ? 7 - dr : dr, c = flip ? 7 - dc : dc;
    const i = r * 8 + c;
    const sq = el("div", "sq " + ((r + c) % 2 ? "dark" : "light"));
    const ch = game.board[i];
    if (last && (last.from === i || last.to === i)) sq.classList.add("last");
    if (ch !== ".") {
      const p = el("span", "piece " + (ch.toLowerCase() === "w" ? "white" : "red"));
      if (ch === "W" || ch === "B") p.textContent = "👑";
      sq.appendChild(p);
    }
    if (movable.has(i)) sq.classList.add("movable");
    if (i === selected) sq.classList.add("selected");
    if (targets.has(i)) sq.classList.add("target");
    sq.addEventListener("click", () => {
      if (targets.has(i)) return play({ from: selected, to: i });
      if (movable.has(i) && game.chain < 0) { selected = i; render(); }
    });
    board.appendChild(sq);
  }
  const [a, b] = damasCount(game.board);
  $m(".g-extra").textContent = `⚪ ${a}   ·   🔴 ${b}` + (my && moves.some((m) => m.cap >= 0) ? "   ·   ¡Comer es obligatorio!" : "");
}

function renderCachipun(board, pi) {
  if (game.last) {
    const L = game.last;
    const res = el("div", "rps-last");
    const verdict = L.result === "draw" ? "Empate" : L.result === pi ? "¡Ganaste la ronda!" : `Ronda para ${ctx.partner().name}`;
    res.textContent = `Tú ${RPS[L[pi]].icon}  vs  ${RPS[L[1 - pi]].icon} ${ctx.partner().name} — ${verdict}`;
    board.appendChild(res);
  }
  const row = el("div", "rps-row");
  const mine = game.picks?.[pi];
  const done = game.winner !== null && game.winner !== undefined;
  for (const [k, v] of Object.entries(RPS)) {
    const b = el("button", "rps-btn");
    b.textContent = v.icon;
    b.title = k;
    if (mine === k) b.classList.add("picked");
    b.disabled = !!mine || done;
    b.addEventListener("click", () => play({ choice: k }));
    row.appendChild(b);
  }
  board.appendChild(row);
}

// ---------------- JENGA ----------------
function jengaReset() {
  if (jAnim) cancelAnimationFrame(jAnim);
  jAnim = null;
  jPick = null;
}

// Aleatorio "estable" por bloque para la caída (igual en ambos teléfonos)
function rnd(seed) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function renderJenga(board, pi) {
  const my = isMyTurn("jenga", game, pi);
  const L = jengaLevels(game.board);
  const last = game.last && typeof game.last === "object" ? game.last : null;
  if (!my || (jPick && !jengaCanTake(game.board, jPick.level, jPick.pos))) jengaReset();

  const tower = el("div", "jenga-tower");
  if (game.fallen) tower.classList.add("fallen");
  if (jPick) {
    tower.classList.add("wobble");
    tower.style.setProperty("--wob", `${(0.5 - jPick.width) * 2.2}deg`);
  }
  for (let l = 0; l < L; l++) {
    const row = el("div", `jrow ${l % 2 ? "odd" : "even"}`);
    for (let p = 0; p < 3; p++) {
      const i = l * 3 + p;
      const b = el("button", "jblock");
      b.type = "button";
      if (game.board[i] !== "1") b.classList.add("gone");
      else {
        const can = my && jengaCanTake(game.board, l, p);
        if (can) b.classList.add("can");
        else b.disabled = true;
        if (jPick && jPick.level === l && jPick.pos === p) b.classList.add("picked");
        if (last?.ok && last.placed === i && jLastAnimated !== `${currentId}:${game.moves}`) {
          b.classList.add("placed");
          jLastAnimated = `${currentId}:${game.moves}`;
        }
        if (game.fallen) {
          const r1 = rnd(i + 1), r2 = rnd(i + 101), r3 = rnd(i + 201);
          b.style.setProperty("--fx", `${(r1 - 0.5) * 2 * (40 + l * 9)}px`);
          b.style.setProperty("--fy", `${l * 19 - r2 * 8}px`);
          b.style.setProperty("--fr", `${(r3 - 0.5) * (60 + l * 12)}deg`);
          b.style.transitionDelay = `${(L - l) * 25}ms`;
        }
        b.addEventListener("click", () => {
          if (!jengaCanTake(game.board, l, p) || !isMyTurn("jenga", game, myIndex())) return;
          const width = jengaZone(game.board, l, p);
          const center = width / 2 + 0.04 + Math.random() * (1 - width - 0.08);
          jengaReset();
          jPick = { level: l, pos: p, width, center };
          render();
        });
      }
      row.appendChild(b);
    }
    tower.appendChild(row);
  }
  const wrap = el("div", "jenga-wrap");
  wrap.appendChild(tower);
  board.appendChild(wrap);

  // Barra para sacar el bloque
  const extra = $m(".g-extra");
  if (game.winner !== null && game.winner !== undefined) return;
  if (!my) { extra.textContent = "Mira con cuidado… 👀"; return; }
  if (!jPick) { extra.textContent = "Toca un bloque para sacarlo (los de arriba no se pueden)"; return; }

  extra.textContent = "";
  const hint = el("div", "jenga-hint");
  hint.textContent = jPick.width < 0.1 ? "😱 ¡Muy peligroso! Detén la aguja en lo verde" : "Detén la aguja en la zona verde";
  const meter = el("div", "jenga-meter");
  const zone = el("div", "jzone");
  zone.style.left = `${(jPick.center - jPick.width / 2) * 100}%`;
  zone.style.width = `${jPick.width * 100}%`;
  const needle = el("div", "jneedle");
  meter.append(zone, needle);
  const btns = el("div", "jenga-btns");
  const pull = el("button", "g-btn");
  pull.type = "button";
  pull.textContent = "✋ ¡Sacar!";
  const cancel = el("button", "g-btn ghost");
  cancel.type = "button";
  cancel.textContent = "Otro bloque";
  btns.append(cancel, pull);
  extra.append(hint, meter, btns);

  const period = Math.max(700, 1600 - game.moves * 35); // ms, cada vez más rápido
  if (jAnim) cancelAnimationFrame(jAnim);
  const t0 = performance.now();
  let pos = 0;
  const tick = (t) => {
    pos = (1 - Math.cos(((t - t0) / period) * Math.PI * 2)) / 2;
    needle.style.left = `${pos * 100}%`;
    jAnim = requestAnimationFrame(tick);
  };
  jAnim = requestAnimationFrame(tick);

  cancel.addEventListener("click", () => { jengaReset(); render(); });
  pull.addEventListener("click", () => {
    if (!jPick) return;
    const pick = jPick;
    const ok = Math.abs(pos - pick.center) <= pick.width / 2;
    jengaReset();
    needle.style.left = `${pos * 100}%`;
    meter.classList.add(ok ? "hit" : "miss");
    pull.disabled = cancel.disabled = true;
    hint.textContent = ok ? "¡Bien! 😮‍💨" : "¡Uy! 😱";
    setTimeout(() => play({ level: pick.level, pos: pick.pos, ok }), 450);
  });
}
