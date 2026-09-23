import { firebaseConfig, FAMILY } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, query, orderBy, limitToLast, onSnapshot, addDoc, doc, setDoc, updateDoc,
  writeBatch, serverTimestamp, deleteField, connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { AVATARS, REACTIONS, emojiOnlyCount, createEmojiPicker, insertAtCursor } from "./emoji.js";
import { registerSW, notify, notifState, toggleNotifications, pop } from "./notify.js";
import { initGames, openGamesMenu, openGame } from "./games.js";
import { GAMES } from "./games-logic.js";

// ---------- Firebase ----------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname) && location.search.includes("emulador");
let db;
try {
  // Caché local: el historial abre al instante y funciona sin señal
  db = initializeFirestore(app, LOCAL ? {} : {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch {
  db = initializeFirestore(app, {});
}
if (LOCAL) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

registerSW();

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const loading = $("loading");
const loginScreen = $("login-screen");
const loginForm = $("login-form");
const loginError = $("login-error");
const loginBtn = $("login-btn");
const loginEmail = $("login-email");
const loginPass = $("login-pass");
const profilesGrid = $("profiles-grid");
const chatApp = $("chat-app");
const headerAvatar = $("header-avatar");
const partnerNameEl = $("chat-partner-name");
const meBtn = $("me-btn");
const statusDot = $("status-dot");
const statusText = $("status-text");
const logoutBtn = $("logout-btn");
const bellBtn = $("bell-btn");
const netBanner = $("net-banner");
const container = $("messages-container");
const list = $("messages-list");
const loadMoreBtn = $("load-more");
const typingIndicator = $("typing-indicator");
const typingText = $("typing-text");
const sendForm = $("send-form");
const input = $("message-input");
const btnAttach = $("btn-attach");
const btnEmoji = $("btn-emoji");
const btnGames = $("btn-games");
const emojiPanel = $("emoji-panel");
const fileInput = $("file-input");
const lightbox = $("lightbox-modal");
const lightboxImg = $("lightbox-img");
const lightboxDownload = $("lightbox-download");
const toastEl = $("toast");
const reactionBar = $("reaction-bar");
const avatarModal = $("avatar-modal");
const avatarGrid = $("avatar-grid");

// ---------- Estado ----------
const PAGE = 50;
const ONLINE_WINDOW_MS = 75_000;
const HEARTBEAT_MS = 30_000;

let me = null;            // { uid, email, name, avatar }
let partner = null;       // { email, name, avatar }
let msgLimit = PAGE;
let unsubMessages = null;
let unsubStatus = null;
let heartbeatTimer = null;
let statusTimer = null;
let typingStopTimer = null;
let typingHideTimer = null;
let lastTypingSent = 0;
let lastDocs = [];
let partnerStatus = null;
let keepScrollFromBottom = null;
let unreadHidden = 0;
let reactTarget = null;   // id del mensaje al que se reacciona
const bubbles = new Map(); // id -> element

// ---------- Avatares guardados (para la pantalla de login) ----------
function cachedAvatar(email) {
  try { return localStorage.getItem("avatar_" + email) || FAMILY[email].avatar; } catch { return FAMILY[email].avatar; }
}
function cacheAvatar(email, a) {
  try { localStorage.setItem("avatar_" + email, a); } catch {}
}

// ---------- Login ----------
function renderProfiles() {
  profilesGrid.innerHTML = "";
  Object.entries(FAMILY).forEach(([email, p]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "profile-btn";
    const av = document.createElement("div");
    av.className = "avatar";
    av.textContent = cachedAvatar(email);
    const name = document.createElement("span");
    name.textContent = p.name;
    b.append(av, name);
    b.addEventListener("click", () => {
      profilesGrid.querySelectorAll(".profile-btn").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
      loginEmail.value = email;
      $("login-hint").textContent = `Hola ${p.name}, escribe tu clave`;
      loginPass.classList.remove("hidden");
      loginBtn.classList.remove("hidden");
      loginPass.focus();
    });
    profilesGrid.appendChild(b);
  });
}

onAuthStateChanged(auth, (user) => {
  loading.classList.add("hidden");
  if (!user) return showLogin();

  const email = (user.email || "").toLowerCase();
  const profile = FAMILY[email];
  if (!profile) {
    signOut(auth);
    return showLogin("Esta cuenta no tiene acceso.");
  }
  const partnerEmail = Object.keys(FAMILY).find((e) => e !== email);
  me = { uid: user.uid, email, ...profile, avatar: cachedAvatar(email) };
  partner = { email: partnerEmail, ...FAMILY[partnerEmail], avatar: cachedAvatar(partnerEmail) };
  startChat();
});

function showLogin(msg = "") {
  stopChat();
  renderProfiles();
  chatApp.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  loginBtn.disabled = false;
  loginBtn.textContent = "Entrar";
  loginError.textContent = msg;
  loginError.classList.toggle("hidden", !msg);
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!loginEmail.value) return showLogin("Toca tu nombre primero.");
  loginBtn.disabled = true;
  loginBtn.textContent = "Entrando…";
  loginError.classList.add("hidden");
  try {
    await signInWithEmailAndPassword(auth, loginEmail.value, loginPass.value);
    loginPass.value = "";
  } catch (err) {
    console.error(err);
    showLogin(err.code === "auth/too-many-requests"
      ? "Demasiados intentos. Espera unos minutos."
      : "Clave incorrecta.");
  }
});

logoutBtn.addEventListener("click", async () => {
  if (!confirm("¿Cerrar sesión?")) return;
  await setStatus({ online: false, typing: false }).catch(() => {});
  stopChat();
  await signOut(auth);
});

// ---------- Chat ----------
function startChat() {
  loginScreen.classList.add("hidden");
  chatApp.classList.remove("hidden");
  partnerNameEl.textContent = partner.name;
  renderAvatars();
  renderBell();
  document.title = `Chat con ${partner.name}`;

  msgLimit = PAGE;
  subscribeMessages();
  subscribeStatus();

  setStatus({ online: true, typing: false });
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (document.visibilityState === "visible") setStatus({ online: true });
  }, HEARTBEAT_MS);
  clearInterval(statusTimer);
  statusTimer = setInterval(renderPartnerStatus, 10_000);
}

function stopChat() {
  unsubMessages?.(); unsubMessages = null;
  unsubStatus?.(); unsubStatus = null;
  clearInterval(heartbeatTimer);
  clearInterval(statusTimer);
  bubbles.clear();
  list.innerHTML = "";
  lastDocs = [];
  partnerStatus = null;
  me = null;
}

function renderAvatars() {
  headerAvatar.textContent = partner.avatar;
  meBtn.textContent = `${me.avatar} ${me.name}`;
}

function subscribeMessages() {
  unsubMessages?.();
  bubbles.clear();
  list.innerHTML = "";
  let first = true;

  const q = query(collection(db, "messages"), orderBy("createdAt"), limitToLast(msgLimit));
  unsubMessages = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    const wasAtBottom = isNearBottom();
    let ownNew = false;

    snap.docChanges({ includeMetadataChanges: true }).forEach((ch) => {
      const id = ch.doc.id;
      if (ch.type === "removed") {
        bubbles.get(id)?.remove();
        bubbles.delete(id);
        return;
      }
      const data = ch.doc.data({ serverTimestamps: "estimate" });
      const pending = ch.doc.metadata.hasPendingWrites;
      if (ch.type === "added") {
        const el = buildBubble(id, data, pending);
        bubbles.set(id, el);
        list.insertBefore(el, list.children[ch.newIndex] || null);
        if (!first && data.senderUid === me.uid) ownNew = true;
        if (!first && data.senderUid !== me.uid && !ch.doc.metadata.fromCache) incoming(data);
      } else {
        updateMeta(bubbles.get(id), data, pending);
      }
    });

    lastDocs = snap.docs;
    loadMoreBtn.classList.toggle("hidden", snap.size < msgLimit);

    if (keepScrollFromBottom !== null) {
      container.scrollTop = container.scrollHeight - keepScrollFromBottom;
      keepScrollFromBottom = null;
    } else if (first || wasAtBottom || ownNew) {
      scrollToBottom();
    }
    first = false;
    markRead();
  }, (err) => {
    console.error(err);
    toast("No se pudieron cargar los mensajes (revisa las reglas de Firestore).");
  });
}

// Mensaje nuevo del otro: sonido / notificación / contador en la pestaña
function incoming(m) {
  const body = m.type === "image" ? "📷 Foto"
    : m.type === "game" ? `🎮 Te invitó a jugar ${GAMES[m.game]?.name || ""}`
    : String(m.text || "");
  if (document.visibilityState === "visible") {
    pop();
  } else {
    unreadHidden++;
    document.title = `(${unreadHidden}) Chat con ${partner.name}`;
    notify(`${partner.avatar} ${partner.name}`, body);
  }
}

loadMoreBtn.addEventListener("click", () => {
  keepScrollFromBottom = container.scrollHeight - container.scrollTop;
  msgLimit += PAGE;
  subscribeMessages();
});

// ---------- Enviar ----------
function sendMessage(fields) {
  return addDoc(collection(db, "messages"), {
    senderUid: me.uid, ...fields, createdAt: serverTimestamp(), read: false
  }).catch((err) => { console.error(err); toast("No se pudo enviar."); });
}

sendForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !me) return;
  input.value = "";
  sendTyping(false);
  sendMessage({ type: "text", text });
});

// Foto (comprimida a base64)
btnAttach.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  fileInput.value = "";
  if (!file || !me) return;
  if (!file.type.startsWith("image/")) return toast("Solo se pueden enviar fotos.");
  try {
    toast("Preparando foto…");
    const image = await compressImage(file);
    sendMessage({ type: "image", image });
    hideToast();
  } catch (err) {
    console.error(err);
    toast("No se pudo leer esa foto.");
  }
});

async function compressImage(file) {
  const img = await loadImage(file);
  const LIMIT = 700_000; // caracteres base64 (~500 KB), bajo el máximo de Firestore
  for (const maxSide of [1280, 1024, 800, 640]) {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    for (const q of [0.72, 0.6, 0.5]) {
      const data = canvas.toDataURL("image/jpeg", q);
      if (data.length <= LIMIT) return data;
    }
  }
  throw new Error("Imagen demasiado grande");
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// ---------- Emojis ----------
const picker = createEmojiPicker(emojiPanel, (e) => insertAtCursor(input, e));
btnEmoji.addEventListener("click", () => {
  const open = emojiPanel.classList.toggle("hidden") === false;
  btnEmoji.classList.toggle("active", open);
  if (open) { picker.render(); if (isNearBottom(200)) setTimeout(scrollToBottom, 0); }
});
input.addEventListener("focus", () => {
  // En celular, al abrir el teclado se cierra el panel
  if (matchMedia("(pointer: coarse)").matches) {
    emojiPanel.classList.add("hidden");
    btnEmoji.classList.remove("active");
  }
});

// ---------- Juegos ----------
initGames({
  db,
  me: () => me,
  partner: () => partner,
  toast,
  notify,
  sendInvite: (game, gameId) => sendMessage({ type: "game", game, gameId })
});
btnGames.addEventListener("click", () => openGamesMenu());

// ---------- Burbujas (sin innerHTML con datos del usuario) ----------
function buildBubble(id, m, pending) {
  const isMine = m.senderUid === me.uid;
  const el = document.createElement("div");
  el.className = `message-bubble ${isMine ? "sent" : "received"}`;
  el.dataset.id = id;

  if (m.type === "image" && typeof m.image === "string" && m.image.startsWith("data:image/")) {
    const wrap = document.createElement("div");
    wrap.className = "img-msg-container";
    const img = document.createElement("img");
    img.src = m.image;
    img.alt = "Foto";
    img.decoding = "async";
    img.addEventListener("load", () => { if (isNearBottom(400)) scrollToBottom(); });
    wrap.addEventListener("click", () => { if (!el._longPressed) openLightbox(m.image); });
    wrap.appendChild(img);
    el.appendChild(wrap);
  } else if (m.type === "game" && GAMES[m.game]) {
    const g = GAMES[m.game];
    el.classList.add("game-bubble");
    const t = document.createElement("div");
    t.className = "game-invite";
    t.textContent = isMine ? `${g.icon} Invitaste a jugar ${g.name}` : `${g.icon} ¡${partner.name} te invita a jugar ${g.name}!`;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "g-btn small";
    b.textContent = "🎮 Jugar";
    b.addEventListener("click", () => openGame(String(m.gameId)));
    el.append(t, b);
  } else {
    const text = String(m.text ?? "");
    const t = document.createElement("div");
    t.className = "msg-content";
    t.textContent = text;
    const n = emojiOnlyCount(text);
    if (n > 0 && n <= 3) {
      el.classList.add("big-emoji");
      t.classList.add(n === 1 ? "size-1" : "size-2");
    }
    el.appendChild(t);
  }

  const reacts = document.createElement("div");
  reacts.className = "reactions hidden";
  el.appendChild(reacts);

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const time = document.createElement("span");
  time.className = "msg-time";
  meta.appendChild(time);
  if (isMine) {
    const ticks = document.createElement("span");
    ticks.className = "read-ticks";
    meta.appendChild(ticks);
  }
  el.appendChild(meta);
  attachReactionGestures(el);
  updateMeta(el, m, pending);
  return el;
}

function updateMeta(el, m, pending) {
  if (!el) return;
  const date = m.createdAt?.toDate ? m.createdAt.toDate() : new Date();
  el.querySelector(".msg-time").textContent = formatTime(date);
  const ticks = el.querySelector(".read-ticks");
  if (ticks) {
    ticks.classList.toggle("read", !!m.read);
    ticks.textContent = pending ? "🕓" : m.read ? "✓✓" : "✓";
  }
  // Reacciones
  const box = el.querySelector(".reactions");
  const r = m.reactions && typeof m.reactions === "object" ? m.reactions : {};
  const vals = Object.entries(r).filter(([, v]) => typeof v === "string" && v);
  box.innerHTML = "";
  box.classList.toggle("hidden", vals.length === 0);
  for (const [uid, v] of vals) {
    const s = document.createElement("span");
    s.textContent = v;
    s.title = uid === me.uid ? "Tú" : partner.name;
    if (uid === me.uid) s.classList.add("mine");
    box.appendChild(s);
  }
  el._myReaction = r[me.uid] || null;
}

function formatTime(d) {
  const now = new Date();
  const hm = d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" })} ${hm}`;
}

// ---------- Reacciones ----------
REACTIONS.forEach((e) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = e;
  b.addEventListener("click", () => react(e));
  reactionBar.appendChild(b);
});

function attachReactionGestures(el) {
  let timer = null, sx = 0, sy = 0;
  const start = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    el._longPressed = false;
    sx = e.clientX; sy = e.clientY;
    clearTimeout(timer);
    timer = setTimeout(() => {
      el._longPressed = true;
      navigator.vibrate?.(20);
      showReactionBar(el);
    }, 450);
  };
  const cancel = () => clearTimeout(timer);
  el.addEventListener("pointerdown", start);
  el.addEventListener("pointermove", (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
  el.addEventListener("pointerup", cancel);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("contextmenu", (e) => { e.preventDefault(); showReactionBar(el); });
  el.addEventListener("dblclick", (e) => { e.preventDefault(); window.getSelection()?.removeAllRanges(); showReactionBar(el); });
}

function showReactionBar(el) {
  reactTarget = el.dataset.id;
  reactionBar.querySelectorAll("button").forEach((b) => b.classList.toggle("mine", b.textContent === el._myReaction));
  reactionBar.classList.remove("hidden");
  const rect = el.getBoundingClientRect();
  const w = reactionBar.offsetWidth, h = reactionBar.offsetHeight;
  let top = rect.top - h - 8;
  if (top < 8) top = rect.bottom + 8;
  let left = el.classList.contains("sent") ? rect.right - w : rect.left;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  reactionBar.style.top = `${top}px`;
  reactionBar.style.left = `${left}px`;
}

function hideReactionBar() {
  reactionBar.classList.add("hidden");
  reactTarget = null;
}

document.addEventListener("pointerdown", (e) => {
  if (!reactionBar.classList.contains("hidden") && !reactionBar.contains(e.target) && !e.target.closest?.(".message-bubble")) hideReactionBar();
});
container.addEventListener("scroll", () => { if (!reactionBar.classList.contains("hidden")) hideReactionBar(); });

function react(emoji) {
  const id = reactTarget;
  hideReactionBar();
  if (!id || !me) return;
  const el = bubbles.get(id);
  const same = el?._myReaction === emoji;
  updateDoc(doc(db, "messages", id), { [`reactions.${me.uid}`]: same ? deleteField() : emoji })
    .catch((e) => { console.error(e); toast("No se pudo reaccionar."); });
}

// ---------- Leído ----------
function markRead() {
  if (!me || document.visibilityState !== "visible") return;
  const unread = lastDocs.filter((d) => {
    const x = d.data();
    return x.senderUid !== me.uid && !x.read;
  });
  if (!unread.length) return;
  const batch = writeBatch(db);
  unread.forEach((d) => batch.update(d.ref, { read: true }));
  batch.commit().catch((e) => console.error(e));
}

// ---------- Avatar ----------
AVATARS.forEach((a) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = a;
  b.addEventListener("click", () => {
    if (!me) return;
    me.avatar = a;
    cacheAvatar(me.email, a);
    renderAvatars();
    setStatus({ avatar: a }).catch(() => {});
    avatarModal.classList.add("hidden");
  });
  avatarGrid.appendChild(b);
});
meBtn.addEventListener("click", () => {
  avatarGrid.querySelectorAll("button").forEach((b) => b.classList.toggle("selected", b.textContent === me?.avatar));
  avatarModal.classList.remove("hidden");
});
$("avatar-close").addEventListener("click", () => avatarModal.classList.add("hidden"));
avatarModal.addEventListener("click", (e) => { if (e.target === avatarModal) avatarModal.classList.add("hidden"); });

// ---------- En línea / escribiendo ----------
function setStatus(fields) {
  if (!me) return Promise.resolve();
  return setDoc(doc(db, "status", me.uid), { ...fields, lastSeen: serverTimestamp() }, { merge: true });
}

function subscribeStatus() {
  unsubStatus?.();
  unsubStatus = onSnapshot(collection(db, "status"), (snap) => {
    const mine = snap.docs.find((d) => d.id === me.uid)?.data();
    const other = snap.docs.find((d) => d.id !== me.uid);
    partnerStatus = other ? other.data({ serverTimestamps: "estimate" }) : null;

    if (mine?.avatar && mine.avatar !== me.avatar) { me.avatar = mine.avatar; cacheAvatar(me.email, mine.avatar); }
    if (partnerStatus?.avatar && partnerStatus.avatar !== partner.avatar) {
      partner.avatar = partnerStatus.avatar;
      cacheAvatar(partner.email, partnerStatus.avatar);
    }
    renderAvatars();
    renderPartnerStatus();

    clearTimeout(typingHideTimer);
    if (partnerStatus?.typing && isPartnerOnline()) {
      typingText.textContent = `${partner.name} está escribiendo...`;
      typingIndicator.classList.remove("hidden");
      typingHideTimer = setTimeout(() => typingIndicator.classList.add("hidden"), 6000);
    } else {
      typingIndicator.classList.add("hidden");
    }
  }, (err) => console.error(err));
}

function isPartnerOnline() {
  if (!partnerStatus?.online || !partnerStatus.lastSeen) return false;
  return Date.now() - partnerStatus.lastSeen.toMillis() < ONLINE_WINDOW_MS;
}

function renderPartnerStatus() {
  if (isPartnerOnline()) {
    statusDot.className = "status-dot online";
    statusText.textContent = "En línea";
  } else {
    statusDot.className = "status-dot offline";
    statusText.textContent = partnerStatus?.lastSeen
      ? `Últ. vez ${formatTime(partnerStatus.lastSeen.toDate())}`
      : "Desconectado";
  }
}

function sendTyping(isTyping) {
  if (!me) return;
  clearTimeout(typingStopTimer);
  if (isTyping) {
    if (Date.now() - lastTypingSent > 3000) {
      lastTypingSent = Date.now();
      setStatus({ online: true, typing: true }).catch(() => {});
    }
    typingStopTimer = setTimeout(() => sendTyping(false), 3500);
  } else if (lastTypingSent) {
    lastTypingSent = 0;
    setStatus({ typing: false }).catch(() => {});
  }
}
input.addEventListener("input", () => sendTyping(input.value.length > 0));

document.addEventListener("visibilitychange", () => {
  if (!me) return;
  if (document.visibilityState === "visible") {
    unreadHidden = 0;
    document.title = `Chat con ${partner.name}`;
    setStatus({ online: true });
    markRead();
  } else {
    setStatus({ online: false, typing: false });
  }
});
window.addEventListener("pagehide", () => { if (me) setStatus({ online: false, typing: false }); });

// ---------- Notificaciones ----------
function renderBell() {
  const s = notifState();
  bellBtn.classList.toggle("hidden", s === "unsupported");
  bellBtn.innerHTML = s === "granted"
    ? '<i class="fa-solid fa-bell"></i>'
    : '<i class="fa-solid fa-bell-slash"></i>';
  bellBtn.title = s === "granted" ? "Notificaciones activadas" : "Activar notificaciones";
}
bellBtn.addEventListener("click", async () => {
  const s = await toggleNotifications();
  renderBell();
  if (s === "granted") toast("🔔 Notificaciones activadas");
  else if (s === "off") toast("🔕 Notificaciones desactivadas");
  else if (s === "denied") toast("Las notificaciones están bloqueadas en el navegador. Actívalas en la configuración del sitio.");
});

// ---------- Red ----------
function updateNet() { netBanner.classList.toggle("hidden", navigator.onLine); }
window.addEventListener("online", updateNet);
window.addEventListener("offline", updateNet);
updateNet();

// ---------- Visor de fotos ----------
function openLightbox(src) {
  lightboxImg.src = src;
  lightboxDownload.href = src;
  lightbox.classList.remove("hidden");
}
$("lightbox-close").addEventListener("click", () => lightbox.classList.add("hidden"));
lightbox.addEventListener("click", (e) => { if (e.target === lightbox) lightbox.classList.add("hidden"); });

// ---------- Utilidades ----------
function isNearBottom(px = 120) {
  return container.scrollHeight - container.scrollTop - container.clientHeight < px;
}
function scrollToBottom() { container.scrollTop = container.scrollHeight; }

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 3500);
}
function hideToast() { toastEl.classList.add("hidden"); }
