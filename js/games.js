// Juegos en tiempo real (UI + Firestore)
import {
  collection, doc, setDoc, onSnapshot, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {
  GAMES, newState, applyMove, isMyTurn, gatoWinLine, cuatroFindWin, C4_ROWS, C4_COLS,
  damasLegalMoves, damasCount, RPS, RPS_TARGET, jengaLevels, jengaCanTake, jengaZone,
  PICTIONARY_WORDS, PICTIONARY_ROUND_MS, PICTIONARY_REVEAL_MS, gameTime
} from "./games-logic.js";

let ctx = null;          // { db, me(), partner(), toast, notify, sendInvite }
let unsub = null;
let currentId = null;
let game = null;         // datos del documento
let selected = -1;       // damas: casilla seleccionada
let busy = false;
let wasMyTurn = null;
let joining = false;

const STATE_KEYS = ["turn", "winner", "moves", "last", "board", "chain", "picks", "score", "round", "fallen", "drawer", "word", "strokes", "guesses", "phase", "roundStartedAt", "roundEndedAt", "roundOutcome"];
let pTimer = null;
let pLastAttempt = 0;
let jPick = null;        // jenga: { level, pos, center, width }
let jAnim = null;        // requestAnimationFrame id
let jLastAnimated = "";  // para no repetir la animación del bloque puesto
let pColor = "#000000";  // pictionary: color seleccionado
let pWidth = 4;          // pictionary: grosor seleccionado
let pStrokeQueue = [];
let pDrawing = false;    // pictionary: si está dibujando activamente

// ---------- DOM (usando modal unificado glassmorphism) ----------
const menu = el("div", "modal-unified hidden");
menu.innerHTML = `
  <div class="modal-sheet narrow">
    <div class="modal-head">
      <div class="modal-titles">
        <h3>🎮 Juegos</h3>
        <p>Elige un juego para invitar</p>
      </div>
      <button class="modal-close game-close" title="Cerrar" aria-label="Cerrar"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="game-list"></div>
  </div>`;
const modal = el("div", "modal-unified game-fullscreen hidden");
modal.innerHTML = `
  <div class="modal-sheet wide game-play">
    <div class="modal-head">
      <div class="modal-titles">
        <h3 class="g-title"></h3>
      </div>
      <button class="modal-close game-video-btn" type="button" title="Videollamada mientras juegas" aria-label="Videollamada mientras juegas">📹</button>
      <button class="modal-close game-close" title="Cerrar" aria-label="Cerrar"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="g-players"></div>
    <div class="g-status"></div>
    <div class="g-countdown hidden" role="timer" aria-label="Tiempo de la ronda"></div>
    <div class="g-board"></div>
    <div class="g-extra"></div>
    <div class="g-foot"></div>
  </div>`;
document.body.append(menu, modal);

const $m = (s) => modal.querySelector(s);
menu.querySelector(".game-close").addEventListener("click", () => menu.classList.add("hidden"));
menu.addEventListener("click", (e) => { if (e.target === menu) menu.classList.add("hidden"); });
$m(".game-close").addEventListener("click", closeGame);
$m(".game-video-btn").addEventListener("click", () => ctx?.video?.());

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
  if (!me || busy) return;
  const target = ctx.destination();
  const ref = doc(collection(ctx.db, "games"));
  busy = true;
  try {
    await setDoc(ref, {
      type,
      chatId: target.chatId,
      players: [me.uid, null],
      ...newState(type),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    const sent = await ctx.sendInvite(type, ref.id, target);
    if (sent && ctx.me()?.uid === target.uid && ctx.destination().chatId === target.chatId) openGame(ref.id);
  } catch (e) {
    console.error(e);
    ctx.toast("No se pudo crear el juego. Inténtalo nuevamente.");
  } finally { busy = false; }
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
  ctx.gameView?.(true);
  pLastAttempt = 0;
  pTimer = setInterval(tickPictionary, 500);

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
    tickPictionary();
  }, (err) => {
    console.error(err);
    $m(".g-status").textContent = "No se pudo cargar el juego.";
  });
}

export function closeGame() {
  clearInterval(pTimer); pTimer = null;
  pDrawing = false;
  ctx?.gameView?.(false);
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
        tx.update(ref, { players: [g.players[0], uid], ...(g.type === 'pictionary' && !g.roundStartedAt ? { roundStartedAt: serverTimestamp() } : {}) });
      }
    });
  } catch (e) { console.warn(e); }
}

async function play(move) {
  if (!currentId) return;
  if (busy) {
    if (move.type === 'stroke') pStrokeQueue.push({id:currentId, round:game.round, move});
    return;
  }
  busy = true;
  const ref = doc(ctx.db, "games", currentId);
  const uid = ctx.me().uid;
  const expectedRound = game?.round;
  if (game?.type === 'pictionary') move = { ...move, round: expectedRound };
  try {
    await runTransaction(ctx.db, async (tx) => {
      const s = await tx.get(ref);
      const g = s.data();
      if (g.type === 'pictionary' && !g.players[1]) throw new Error('Jugada no válida');
      let players = g.players;
      let pi = players.indexOf(uid);
      if (pi < 0 && players[1] === null) { players = [players[0], uid]; pi = 1; }
      if (pi < 0) throw new Error("No eres jugador de esta partida");
      const st = {};
      STATE_KEYS.forEach((k) => { if (g[k] !== undefined) st[k] = g[k]; });
      const next = applyMove(g.type, st, pi, move);
      if (!next) throw new Error("Jugada no válida");
      if (g.type === 'pictionary') {
        if (next.roundStartedAt !== st.roundStartedAt) next.roundStartedAt = serverTimestamp();
        if (next.roundEndedAt !== st.roundEndedAt && next.roundEndedAt !== null) next.roundEndedAt = serverTimestamp();
      }
      tx.update(ref, { ...next, players, updatedAt: serverTimestamp() });
    });
    selected = -1;
  } catch (e) {
    console.warn(e);
    if (!navigator.onLine) ctx.toast("Sin conexión: la jugada no se envió.");
    else if (e.message !== "Jugada no válida" && !['timeout', 'nextRound', 'startClock'].includes(move.type)) ctx.toast("No se pudo enviar la jugada.");
  } finally {
    busy = false;
    const queued = pStrokeQueue.shift();
    if (queued && queued.id === currentId && queued.round === game?.round && game.phase === 'drawing') play(queued.move);
    else pStrokeQueue = [];
  }
}

function tickPictionary() {
  const timer = $m('.g-countdown');
  const active = game?.type === 'pictionary';
  timer.classList.toggle('hidden', !active);
  if (!active) return;
  const now = Date.now();
  const started = gameTime(game.roundStartedAt);
  const ended = gameTime(game.roundEndedAt);
  const remaining = Math.max(0, Math.ceil((started + PICTIONARY_ROUND_MS - now) / 1000));
  timer.textContent = !game.players[1] ? 'Esperando al otro jugador…'
    : game.phase === 'drawing' ? (started ? `⏱️ ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} para adivinar` : 'Preparando la ronda…')
    : game.phase === 'roundEnd' ? `Cambio de dibujante en ${Math.max(0, Math.ceil((ended + PICTIONARY_REVEAL_MS - now) / 1000))} s`
    : 'Partida terminada';
  timer.classList.toggle('urgent', game.phase === 'drawing' && started > 0 && remaining <= 10);
  if (busy || !game.players[1] || now - pLastAttempt < 2000 || document.visibilityState !== 'visible') return;
  let type;
  if (game.phase === 'drawing' && !started) type = 'startClock';
  else if (game.phase === 'drawing' && remaining === 0) type = 'timeout';
  else if (game.phase === 'roundEnd' && (!ended || now >= ended + PICTIONARY_REVEAL_MS)) type = 'nextRound';
  if (type) { pLastAttempt = now; play({ type }); }
}

// ---------- Render ----------
function nameOf(i) {
  const pi = myIndex();
  return i === pi ? "Tú" : ctx.partner().name;
}

function render() {
  if (!game) return;
  const type = game.type;
  modal.classList.toggle("is-pictionary", type === "pictionary");
  const info = GAMES[type];
  const pi = myIndex();
  $m(".g-title").textContent = `${info.icon} ${info.name}`;

  // Jugadores / fichas
  const marks = {
    gato: ["❌", "⭕"], cuatro: ["🔴", "🟡"], damas: ["⚪", "🔴"], cachipun: ["", ""], jenga: ["", ""], pictionary: ["", ""]
  }[type];
  if (type === "jenga") {
    $m(".g-players").textContent = `Pisos: ${jengaLevels(game.board)}   ·   Bloques sacados: ${game.moves}`;
  } else if (type === "cachipun") {
    $m(".g-players").textContent =
      `${nameOf(0)} ${game.score[0]} – ${game.score[1]} ${nameOf(1)}   ·   gana el primero a ${RPS_TARGET}`;
  } else if (type === "pictionary") {
    $m(".g-players").textContent =
      `${nameOf(0)} ${game.score[0]} – ${game.score[1]} ${nameOf(1)}   ·   Ronda ${game.round} / 5`;
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
    else if (type === "pictionary") st.textContent = iWon ? "🎉 ¡Ganaste!" : `🏆 Ganó ${ctx.partner().name}`;
    else st.textContent = iWon ? "🎉 ¡Ganaste!" : `🏆 Ganó ${ctx.partner().name}`;
    st.classList.add(iWon ? "win" : "lose");
  } else if (type === "cachipun") {
    const mine = game.picks?.[pi];
    const other = game.picks?.[1 - pi];
    st.textContent = mine
      ? `Elegiste ${RPS[mine].icon}. Esperando a ${ctx.partner().name}…`
      : other ? `${ctx.partner().name} ya eligió 🤫 ¡Te toca!` : `Ronda ${game.round}: ¡elige!`;
    if (!mine) st.classList.add("turn");
  } else if (type === "pictionary") {
    const amDrawer = game.drawer === pi;
    if (game.phase === "roundEnd" || game.phase === "gameOver") {
      st.textContent = game.roundOutcome === 'timeout' ? `Se acabó el tiempo. Era «${game.word}»`
        : amDrawer ? `¡${ctx.partner().name} lo adivinó!` : '¡Lo adivinaste!';
    } else if (amDrawer) {
      st.textContent = `🎨 Dibuja: "${game.word}"`;
      st.classList.add("turn");
    } else {
      st.textContent = `🤔 ${ctx.partner().name} está dibujando… Adivina!`;
    }
  } else if (isMyTurn(type, game, pi)) {
    st.textContent = type === "damas" && game.chain >= 0 ? "¡Sigue comiendo!" : "¡Tu turno!";
    st.classList.add("turn");
  } else {
    st.textContent = `Turno de ${ctx.partner().name}…`;
  }

  $m(".g-extra").textContent = "";
  const board = $m(".g-board");
  if (type !== "pictionary" || !board.querySelector(".pictionary-container")) {
    board.innerHTML = "";
    board.className = `g-board g-${type}`;
  }
  ({ gato: renderGato, cuatro: renderCuatro, damas: renderDamas, cachipun: renderCachipun, jenga: renderJenga, pictionary: renderPictionary })[type](board, pi);

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

// ---------------- PICTIONARY ----------------
function drawSingleStroke(ctx, stroke, w, h) {
  const pts = stroke.canvasWidth && stroke.canvasHeight
    ? stroke.points.map((p) => ({x:p.x*w/stroke.canvasWidth, y:p.y*h/stroke.canvasHeight})) : stroke.points;
  if (!pts || pts.length === 0) return;
  ctx.strokeStyle = stroke.color || "#000000";
  ctx.lineWidth = stroke.width || 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, (stroke.width || 4) / 2, 0, Math.PI * 2);
    ctx.fillStyle = stroke.color || "#000000";
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i].x + pts[i + 1].x) / 2;
    const midY = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.stroke();
}

function redrawAllStrokes(ctx, w, h, strokes, activeStroke = null) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  strokes.forEach((stroke) => drawSingleStroke(ctx, stroke, w, h));
  if (activeStroke) drawSingleStroke(ctx, activeStroke, w, h);
}

function renderPictionary(board, pi) {
  const amDrawer = game.drawer === pi;
  const ready = Boolean(game.players[1] && gameTime(game.roundStartedAt));
  const canDraw = ready && amDrawer && game.phase === "drawing";
  const canGuess = ready && !amDrawer && game.phase === "drawing";
  const roundEnd = game.phase === "roundEnd" || game.phase === "gameOver";

  let container = board.querySelector(".pictionary-container");
  const previousRound = container?.dataset.round;
  let canvas, ctx2d, width, height;

  if (!container) {
    board.innerHTML = "";
    board.className = "g-board g-pictionary";
    container = el("div", "pictionary-container");

    const canvasWrap = el("div", "pictionary-canvas-wrap");
    canvas = el("canvas", "pictionary-canvas");
    canvasWrap.appendChild(canvas);
    container.appendChild(canvasWrap);

    const uiBox = el("div", "pictionary-ui-box");
    container.appendChild(uiBox);
    board.appendChild(container);

    width = 512;
    height = 512;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = "100%";
    canvas.style.height = "100%";

    ctx2d = canvas.getContext("2d");
    ctx2d.scale(dpr, dpr);

    canvas._ctx2d = ctx2d;
    canvas._w = width;
    canvas._h = height;
    canvas._round = game.round;

    let currentStroke = null, activePointer = null, paintFrame = null;
    const paint = () => {
      if (paintFrame !== null) return;
      paintFrame = requestAnimationFrame(() => {
        paintFrame = null;
        if (canvas.isConnected && currentStroke && canvas._canDraw && pDrawing) redrawAllStrokes(ctx2d, width, height, game.strokes || [], currentStroke);
      });
    };

    function getPos(e) {
      const r = canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(width, (e.clientX - r.left) * (width / r.width))),
        y: Math.max(0, Math.min(height, (e.clientY - r.top) * (height / r.height)))
      };
    }

    canvas.addEventListener("pointerdown", (e) => {
      if (!canvas._canDraw || activePointer !== null || (e.pointerType === "mouse" && e.button !== 0)) return;
      activePointer = e.pointerId;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      pDrawing = true;
      const pos = getPos(e);
      currentStroke = { points: [pos], color: pColor, width: pWidth, canvasWidth: width, canvasHeight: height };
      redrawAllStrokes(ctx2d, width, height, game.strokes || [], currentStroke);
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!pDrawing || !currentStroke || e.pointerId !== activePointer) return;
      e.preventDefault();
      for (const sample of e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e]) {
        const pos = getPos(sample);
        const last = currentStroke.points.at(-1);
        if (Math.hypot(pos.x - last.x, pos.y - last.y) >= .7) currentStroke.points.push(pos);
      }
      paint();
    });

    const endPointer = (e) => {
      if (e.pointerId !== activePointer) return;
      activePointer = null;
      if (!pDrawing || !currentStroke) { currentStroke = null; return; }
      if (e.type === 'pointerup') currentStroke.points.push(getPos(e));
      pDrawing = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      const st = currentStroke;
      currentStroke = null;
      redrawAllStrokes(ctx2d, width, height, game.strokes || [], st);
      if (st.points.length >= 1) {
        play({ type: "stroke", stroke: st });
      }
    };

    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
  } else {
    canvas = container.querySelector(".pictionary-canvas");
    ctx2d = canvas._ctx2d;
    width = canvas._w;
    height = canvas._h;

    if (canvas._round !== game.round) {
      canvas._round = game.round;
      pDrawing = false;
    }
  }

  canvas._canDraw = canDraw;
  if (!canDraw) pDrawing = false;
  canvas.style.cursor = canDraw ? "crosshair" : "default";

  if (!pDrawing) {
    redrawAllStrokes(ctx2d, width, height, game.strokes || []);
  }

  const uiBox = container.querySelector(".pictionary-ui-box");
  const oldInput = uiBox.querySelector('input');
  const keepDraft = previousRound === String(game.round);
  const draft = keepDraft ? oldInput?.value || '' : '';
  const focused = oldInput && document.activeElement === oldInput;
  const caret = oldInput?.selectionStart;
  container.dataset.round = game.round;
  uiBox.innerHTML = "";
  container.querySelector('.p-round-result')?.remove();
  if (roundEnd) {
    const result = el('div', 'p-round-result ' + (game.roundOutcome === 'timeout' ? 'timeout' : 'success'));
    result.setAttribute('role', 'status');
    const icon = el('div', 'p-result-icon'); icon.textContent = game.roundOutcome === 'timeout' ? '⏳' : '🎉';
    const title = el('strong'); title.textContent = game.roundOutcome === 'timeout' ? '¡Se acabó el tiempo!' : amDrawer ? `¡${ctx.partner().name} lo adivinó!` : '¡Lo adivinaste!';
    const word = el('span'); word.textContent = `La palabra era «${game.word}»`;
    const next = el('small'); next.textContent = game.winner !== null ? 'Partida terminada' : `Ahora dibuja ${game.drawer === pi ? ctx.partner().name : 'tú'}`;
    result.append(icon, title, word, next);
    container.querySelector('.pictionary-canvas-wrap').append(result);
  }

  if (canDraw) {
    const toolbar = el("div", "pictionary-toolbar");
    const colorsDiv = el("div", "pictionary-colors");
    const PALETTE = [
      { name: "Negro", hex: "#000000" },
      { name: "Rojo", hex: "#e0282e" },
      { name: "Azul", hex: "#1e4fa3" },
      { name: "Verde", hex: "#1fbf7a" },
      { name: "Amarillo", hex: "#f2c200" },
      { name: "Goma", hex: "#ffffff" }
    ];

    PALETTE.forEach((c) => {
      const btn = el("button", "p-color-btn" + (pColor === c.hex ? " selected" : ""));
      btn.type = "button";
      btn.style.backgroundColor = c.hex;
      btn.title = c.name;
      btn.addEventListener("click", () => {
        pColor = c.hex;
        render();
      });
      colorsDiv.appendChild(btn);
    });

    const sizesDiv = el("div", "pictionary-sizes");
    [
      { label: "✏️ Fino", val: 3 },
      { label: "🖌️ Grueso", val: 9 }
    ].forEach((s) => {
      const btn = el("button", "p-size-btn" + (pWidth === s.val ? " selected" : ""));
      btn.type = "button";
      btn.textContent = s.label;
      btn.addEventListener("click", () => {
        pWidth = s.val;
        render();
      });
      sizesDiv.appendChild(btn);
    });

    const clearBtn = el("button", "g-btn ghost small");
    clearBtn.type = "button";
    clearBtn.textContent = "🗑️ Limpiar";
    clearBtn.addEventListener("click", () => play({ type: "clear" }));

    toolbar.append(colorsDiv, sizesDiv, clearBtn);
    uiBox.appendChild(toolbar);
  }

  if (canGuess && !roundEnd) {
    const guessArea = el("div", "pictionary-guess-area");
    const input = el("input", "pictionary-input");
    input.type = "text";
    input.placeholder = "Escribe tu respuesta…";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.maxLength = 50;
    input.value = draft;

    const sendBtn = el("button", "g-btn");
    sendBtn.type = "button";
    sendBtn.textContent = "Enviar";

    const submitGuess = () => {
      const text = input.value.trim();
      if (text) {
        play({ type: "guess", text });
        input.value = "";
        input.focus();
      }
    };

    sendBtn.addEventListener("click", submitGuess);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitGuess();
    });

    guessArea.append(input, sendBtn);
    uiBox.appendChild(guessArea);
    if (focused) { input.focus(); input.setSelectionRange(caret, caret); }
  }

  if ((game.guesses || []).length > 0) {
    const history = el("div", "pictionary-history");
    game.guesses.forEach((g) => {
      const item = el("div", "pictionary-guess" + (g.correct ? " correct" : ""));
      const name = g.player === pi ? "Tú" : ctx.partner().name;
      item.textContent = `${name}: ${g.text}`;
      history.appendChild(item);
    });
    uiBox.appendChild(history);
  }

  if (amDrawer && !canDraw && !roundEnd) {
    const reveal = el("div", "pictionary-reveal");
    reveal.textContent = `La palabra era: "${game.word}"`;
    uiBox.appendChild(reveal);
  }

}
