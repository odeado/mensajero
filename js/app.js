import { firebaseConfig, FAMILY } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, query, orderBy, limitToLast, onSnapshot, addDoc, doc, setDoc,
  writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// ---------- Firebase ----------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let db;
try {
  // Caché local: el historial abre al instante y funciona sin señal
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch {
  db = initializeFirestore(app, {});
}

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const loading = $("loading");
const loginScreen = $("login-screen");
const loginForm = $("login-form");
const loginError = $("login-error");
const loginBtn = $("login-btn");
const chatApp = $("chat-app");
const headerAvatar = $("header-avatar");
const partnerNameEl = $("chat-partner-name");
const meLabel = $("me-label");
const statusDot = $("status-dot");
const statusText = $("status-text");
const logoutBtn = $("logout-btn");
const netBanner = $("net-banner");
const container = $("messages-container");
const list = $("messages-list");
const loadMoreBtn = $("load-more");
const typingIndicator = $("typing-indicator");
const typingText = $("typing-text");
const sendForm = $("send-form");
const input = $("message-input");
const btnAttach = $("btn-attach");
const fileInput = $("file-input");
const lightbox = $("lightbox-modal");
const lightboxImg = $("lightbox-img");
const lightboxDownload = $("lightbox-download");
const toastEl = $("toast");

// ---------- Estado ----------
const PAGE = 50;
const ONLINE_WINDOW_MS = 75_000;
const HEARTBEAT_MS = 30_000;

let me = null;            // { uid, name, avatar }
let partner = null;       // { name, avatar }
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
const bubbles = new Map(); // id -> element

// ---------- Auth ----------
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
  me = { uid: user.uid, ...profile };
  partner = FAMILY[partnerEmail];
  startChat();
});

// Botones de perfil en el login (sin escribir correo)
const profilesGrid = $("profiles-grid");
const loginEmail = $("login-email");
const loginPass = $("login-pass");
Object.entries(FAMILY).forEach(([email, p]) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "profile-btn";
  const av = document.createElement("div");
  av.className = "avatar";
  av.textContent = p.avatar;
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

function showLogin(msg = "") {
  stopChat();
  chatApp.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  loginBtn.disabled = false;
  loginBtn.textContent = "Entrar";
  loginError.textContent = msg;
  loginError.classList.toggle("hidden", !msg);
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginBtn.disabled = true;
  loginBtn.textContent = "Entrando…";
  loginError.classList.add("hidden");
  try {
    if (!loginEmail.value) { showLogin("Toca Papá o Hija primero."); return; }
    await signInWithEmailAndPassword(auth, loginEmail.value, loginPass.value);
    $("login-pass").value = "";
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
  headerAvatar.textContent = partner.avatar;
  partnerNameEl.textContent = partner.name;
  meLabel.textContent = `${me.avatar} ${me.name}`;
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
  me = null;
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
        const el = buildBubble(data, pending);
        bubbles.set(id, el);
        list.insertBefore(el, list.children[ch.newIndex] || null);
        if (data.senderUid === me.uid && !first) ownNew = true;
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

loadMoreBtn.addEventListener("click", () => {
  keepScrollFromBottom = container.scrollHeight - container.scrollTop;
  msgLimit += PAGE;
  subscribeMessages();
});

// Enviar texto
sendForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !me) return;
  input.value = "";
  input.focus();
  sendTyping(false);
  addDoc(collection(db, "messages"), {
    senderUid: me.uid, type: "text", text, createdAt: serverTimestamp(), read: false
  }).catch((err) => { console.error(err); toast("No se pudo enviar el mensaje."); });
});

// Enviar foto (comprimida a base64)
btnAttach.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  fileInput.value = "";
  if (!file || !me) return;
  if (!file.type.startsWith("image/")) return toast("Solo se pueden enviar fotos.");
  try {
    toast("Preparando foto…");
    const image = await compressImage(file);
    addDoc(collection(db, "messages"), {
      senderUid: me.uid, type: "image", image, createdAt: serverTimestamp(), read: false
    }).catch((err) => { console.error(err); toast("No se pudo enviar la foto."); });
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

// ---------- Burbujas (sin innerHTML con datos del usuario) ----------
function buildBubble(m, pending) {
  const isMine = m.senderUid === me.uid;
  const el = document.createElement("div");
  el.className = `message-bubble ${isMine ? "sent" : "received"}`;

  if (m.type === "image" && typeof m.image === "string" && m.image.startsWith("data:image/")) {
    const wrap = document.createElement("div");
    wrap.className = "img-msg-container";
    const img = document.createElement("img");
    img.src = m.image;
    img.alt = "Foto";
    img.decoding = "async";
    img.addEventListener("load", () => { if (isNearBottom(400)) scrollToBottom(); });
    wrap.addEventListener("click", () => openLightbox(m.image));
    wrap.appendChild(img);
    el.appendChild(wrap);
  } else {
    const t = document.createElement("div");
    t.className = "msg-content";
    t.textContent = String(m.text ?? "");
    el.appendChild(t);
  }

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
}

function formatTime(d) {
  const now = new Date();
  const hm = d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" })} ${hm}`;
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

// ---------- En línea / escribiendo ----------
function setStatus(fields) {
  if (!me) return Promise.resolve();
  return setDoc(doc(db, "status", me.uid), { ...fields, lastSeen: serverTimestamp() }, { merge: true });
}

function subscribeStatus() {
  unsubStatus?.();
  unsubStatus = onSnapshot(collection(db, "status"), (snap) => {
    const other = snap.docs.find((d) => d.id !== me.uid);
    partnerStatus = other ? other.data({ serverTimestamps: "estimate" }) : null;
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
    setStatus({ online: true });
    markRead();
  } else {
    setStatus({ online: false, typing: false });
  }
});
window.addEventListener("pagehide", () => { if (me) setStatus({ online: false, typing: false }); });

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
