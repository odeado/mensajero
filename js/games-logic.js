// Lógica pura de los juegos (sin Firebase ni DOM).
// Jugador 0 = quien creó la partida (empieza). Jugador 1 = el otro.

export const GAMES = {
  gato:     { name: "Gato",        icon: "❌", desc: "Tres en línea" },
  cuatro:   { name: "4 en línea",  icon: "🔴", desc: "Junta 4 fichas" },
  damas:    { name: "Damas",       icon: "👑", desc: "Come todas las fichas" },
  cachipun: { name: "Cachipún",    icon: "✊", desc: "Piedra, papel o tijera (a 3)" },
  jenga:    { name: "Jenga",       icon: "🧱", desc: "Saca bloques sin botar la torre" }
};

export function newState(type) {
  const base = { turn: 0, winner: null, moves: 0, last: null };
  switch (type) {
    case "gato": return { ...base, board: ".".repeat(9) };
    case "cuatro": return { ...base, board: ".".repeat(42) };
    case "damas": return { ...base, board: damasInitial(), chain: -1 };
    case "cachipun": return { ...base, picks: {}, score: [0, 0], round: 1 };
    case "jenga": return { ...base, board: "111".repeat(JENGA_LEVELS), fallen: false };
  }
  throw new Error("Juego desconocido");
}

const setAt = (s, i, ch) => s.slice(0, i) + ch + s.slice(i + 1);

// ---------------- GATO ----------------
const GATO_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

export function gatoMove(st, player, cell) {
  if (st.winner !== null || st.turn !== player) return null;
  if (cell < 0 || cell > 8 || st.board[cell] !== ".") return null;
  const board = setAt(st.board, cell, player === 0 ? "X" : "O");
  const line = gatoWinLine(board);
  const winner = line ? player : board.includes(".") ? null : "draw";
  return { ...st, board, turn: 1 - player, winner, moves: st.moves + 1, last: cell };
}

export function gatoWinLine(board) {
  for (const l of GATO_LINES) {
    const [a, b, c] = l;
    if (board[a] !== "." && board[a] === board[b] && board[b] === board[c]) return l;
  }
  return null;
}

// ---------------- 4 EN LÍNEA (6 filas x 7 columnas) ----------------
export const C4_ROWS = 6, C4_COLS = 7;

export function cuatroMove(st, player, col) {
  if (st.winner !== null || st.turn !== player) return null;
  if (col < 0 || col >= C4_COLS) return null;
  let row = -1;
  for (let r = C4_ROWS - 1; r >= 0; r--) {
    if (st.board[r * C4_COLS + col] === ".") { row = r; break; }
  }
  if (row < 0) return null;
  const idx = row * C4_COLS + col;
  const board = setAt(st.board, idx, player === 0 ? "R" : "A");
  const line = cuatroWinLine(board, idx);
  const winner = line ? player : board.includes(".") ? null : "draw";
  return { ...st, board, turn: 1 - player, winner, moves: st.moves + 1, last: idx };
}

export function cuatroWinLine(board, idx) {
  const ch = board[idx];
  if (ch === ".") return null;
  const r0 = Math.floor(idx / C4_COLS), c0 = idx % C4_COLS;
  for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
    const cells = [idx];
    for (const s of [1, -1]) {
      let r = r0 + dr * s, c = c0 + dc * s;
      while (r >= 0 && r < C4_ROWS && c >= 0 && c < C4_COLS && board[r * C4_COLS + c] === ch) {
        cells.push(r * C4_COLS + c);
        r += dr * s; c += dc * s;
      }
    }
    if (cells.length >= 4) return cells;
  }
  return null;
}

export function cuatroFindWin(board) {
  for (let i = 0; i < board.length; i++) {
    const l = cuatroWinLine(board, i);
    if (l) return l;
  }
  return null;
}

// ---------------- DAMAS ----------------
// Tablero 8x8 como string de 64. Casillas oscuras: (fila+col) impar.
// Jugador 0: "w" (rey "W"), empieza abajo (filas 5-7) y avanza hacia arriba.
// Jugador 1: "b" (rey "B"), empieza arriba (filas 0-2) y avanza hacia abajo.
// Reglas: comer es obligatorio, se puede comer en cadena con la misma ficha,
// las fichas comen solo hacia adelante, el rey mueve/come 1 casilla en cualquier diagonal.

function damasInitial() {
  let s = "";
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const dark = (r + c) % 2 === 1;
    s += dark && r <= 2 ? "b" : dark && r >= 5 ? "w" : ".";
  }
  return s;
}

const owner = (ch) => (ch === "w" || ch === "W" ? 0 : ch === "b" || ch === "B" ? 1 : -1);
const isKing = (ch) => ch === "W" || ch === "B";

function pieceDirs(ch) {
  if (isKing(ch)) return [[-1,-1],[-1,1],[1,-1],[1,1]];
  return owner(ch) === 0 ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]];
}

function capturesFrom(board, i) {
  const ch = board[i], p = owner(ch), out = [];
  const r = Math.floor(i / 8), c = i % 8;
  for (const [dr, dc] of pieceDirs(ch)) {
    const mr = r + dr, mc = c + dc, tr = r + 2 * dr, tc = c + 2 * dc;
    if (tr < 0 || tr > 7 || tc < 0 || tc > 7) continue;
    const mid = mr * 8 + mc, to = tr * 8 + tc;
    if (owner(board[mid]) === 1 - p && board[to] === ".") out.push({ from: i, to, cap: mid });
  }
  return out;
}

function stepsFrom(board, i) {
  const ch = board[i], out = [];
  const r = Math.floor(i / 8), c = i % 8;
  for (const [dr, dc] of pieceDirs(ch)) {
    const tr = r + dr, tc = c + dc;
    if (tr < 0 || tr > 7 || tc < 0 || tc > 7) continue;
    const to = tr * 8 + tc;
    if (board[to] === ".") out.push({ from: i, to, cap: -1 });
  }
  return out;
}

export function damasLegalMoves(st, player) {
  if (st.winner !== null || st.turn !== player) return [];
  const b = st.board;
  if (st.chain >= 0) return capturesFrom(b, st.chain);
  let caps = [], steps = [];
  for (let i = 0; i < 64; i++) {
    if (owner(b[i]) !== player) continue;
    caps = caps.concat(capturesFrom(b, i));
    steps = steps.concat(stepsFrom(b, i));
  }
  return caps.length ? caps : steps;
}

export function damasMove(st, player, from, to) {
  const mv = damasLegalMoves(st, player).find((m) => m.from === from && m.to === to);
  if (!mv) return null;
  let board = st.board;
  let ch = board[from];
  board = setAt(board, from, ".");
  if (mv.cap >= 0) board = setAt(board, mv.cap, ".");
  const row = Math.floor(to / 8);
  let crowned = false;
  if (ch === "w" && row === 0) { ch = "W"; crowned = true; }
  if (ch === "b" && row === 7) { ch = "B"; crowned = true; }
  board = setAt(board, to, ch);

  let next = { ...st, board, moves: st.moves + 1, last: { from, to, cap: mv.cap }, chain: -1 };
  // ¿Sigue comiendo con la misma ficha?
  if (mv.cap >= 0 && !crowned && capturesFrom(board, to).length) {
    next.chain = to;
    next.turn = player;
  } else {
    next.turn = 1 - player;
  }
  // ¿Ganó alguien?
  const opp = 1 - player;
  const oppHas = [...board].some((c) => owner(c) === opp);
  if (!oppHas) next.winner = player;
  else if (next.turn === opp && damasLegalMoves(next, opp).length === 0) next.winner = player;
  return next;
}

export function damasCount(board) {
  let a = 0, b = 0;
  for (const c of board) { if (owner(c) === 0) a++; else if (owner(c) === 1) b++; }
  return [a, b];
}

// ---------------- CACHIPÚN ----------------
export const RPS = {
  piedra: { icon: "✊", beats: "tijera" },
  papel:  { icon: "✋", beats: "piedra" },
  tijera: { icon: "✌️", beats: "papel" }
};
export const RPS_TARGET = 3;

export function cachipunPick(st, player, choice) {
  if (st.winner !== null || !RPS[choice]) return null;
  if (st.picks[player] !== undefined) return null;
  const picks = { ...st.picks, [player]: choice };
  if (picks[0] === undefined || picks[1] === undefined) {
    return { ...st, picks };
  }
  const a = picks[0], b = picks[1];
  const result = a === b ? "draw" : RPS[a].beats === b ? 0 : 1;
  const score = [...st.score];
  if (result !== "draw") score[result]++;
  const winner = score[0] >= RPS_TARGET ? 0 : score[1] >= RPS_TARGET ? 1 : null;
  return {
    ...st, picks: {}, score, winner,
    round: st.round + 1, moves: st.moves + 1,
    last: { 0: a, 1: b, result }
  };
}

// ---------------- JENGA ----------------
// Torre: string con 3 caracteres por piso ("1" = hay bloque), piso 0 = abajo.
// El piso de más arriba se va llenando con los bloques que se sacan.
// No se puede sacar del piso de arriba (ni del de abajo de él si el de arriba está incompleto).
// Cada piso debe quedar con al menos 1 bloque.
export const JENGA_LEVELS = 12;

export function jengaLevels(board) { return board.length / 3; }

function jengaTopCount(board) {
  const L = jengaLevels(board);
  return [...board.slice((L - 1) * 3)].filter((c) => c === "1").length;
}

export function jengaCanTake(board, level, pos) {
  const L = jengaLevels(board);
  if (level < 0 || level >= L || pos < 0 || pos > 2) return false;
  const topFull = jengaTopCount(board) === 3;
  const lastAllowed = topFull ? L - 2 : L - 3;
  if (level > lastAllowed) return false;
  const row = board.slice(level * 3, level * 3 + 3);
  if (row[pos] !== "1") return false;
  return [...row].filter((c) => c === "1").length >= 2;
}

// Ancho de la zona verde (0..1): más chico = más difícil
export function jengaZone(board, level, pos) {
  const row = board.slice(level * 3, level * 3 + 3).split("");
  row[pos] = "0";
  const left = row.filter((c) => c === "1").length;
  let w;
  if (left === 2) w = pos === 1 ? 0.34 : 0.4;            // queda firme
  else if (row[1] === "1") w = 0.2;                     // queda solo el del medio: se sostiene
  else w = 0.07;                                        // queda solo un lado: ¡muy peligroso!
  const L = jengaLevels(board);
  w *= Math.max(0.45, 1 - (L - JENGA_LEVELS) * 0.06);   // torre más alta = más difícil
  if (level < 3) w *= 0.85;                             // abajo carga más peso
  return Math.max(0.05, Math.min(0.45, w));
}

export function jengaMove(st, player, move) {
  if (st.winner !== null || st.turn !== player) return null;
  const { level, pos, ok } = move;
  if (!jengaCanTake(st.board, level, pos)) return null;
  if (!ok) {
    return { ...st, fallen: true, winner: 1 - player, moves: st.moves + 1, last: { level, pos, ok: false } };
  }
  let board = setAt(st.board, level * 3 + pos, "0");
  // Poner el bloque arriba
  const L = jengaLevels(board);
  const topCount = [...board.slice((L - 1) * 3)].filter((c) => c === "1").length;
  let placed;
  if (topCount === 3) { board += "100"; placed = L * 3; }
  else { placed = (L - 1) * 3 + topCount; board = setAt(board, placed, "1"); }
  return { ...st, board, turn: 1 - player, moves: st.moves + 1, last: { level, pos, ok: true, placed } };
}

// Turno "lógico" para mostrar/avisar
export function isMyTurn(type, st, player) {
  if (st.winner !== null) return false;
  if (type === "cachipun") return st.picks[player] === undefined;
  return st.turn === player;
}

export function applyMove(type, st, player, move) {
  switch (type) {
    case "gato": return gatoMove(st, player, move.cell);
    case "cuatro": return cuatroMove(st, player, move.col);
    case "damas": return damasMove(st, player, move.from, move.to);
    case "cachipun": return cachipunPick(st, player, move.choice);
    case "jenga": return jengaMove(st, player, move);
  }
  return null;
}
