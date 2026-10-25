import { firebaseConfig, FAMILY, CHATS } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, query, where, orderBy, limitToLast, onSnapshot, addDoc, doc, setDoc, updateDoc,
  writeBatch, serverTimestamp, deleteField, connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { AVATARS, REACTIONS, emojiOnlyCount, createEmojiPicker, insertAtCursor } from "./emoji.js";
import { registerSW, notify, notifState, toggleNotifications, pop } from "./notify.js";
import { initGames, openGamesMenu, openGame } from "./games.js";
import { GAMES } from "./games-logic.js";
import { playMsnCard } from "./msncard.js";

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
const loginUser = $("login-user");
const loginPass = $("login-pass");
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
const btnDemoCard = $("btn-demo-card");
const emojiPanel = $("emoji-panel");
const fileInput = $("file-input");
const lightbox = $("lightbox-modal");
const lightboxImg = $("lightbox-img");
const lightboxDownload = $("lightbox-download");
const toastEl = $("toast");
const reactionBar = $("reaction-bar");
const avatarModal = $("avatar-modal");
const avatarGrid = $("avatar-grid");
const switchChatBtn = $("switch-chat-btn");
const chatPickerModal = $("chat-picker-modal");
const chatPickerClose = $("chat-picker-close");
const chatPickerGrid = $("chat-picker-grid");
const welcomeText = $("welcome-text");

// ---------- Estado ----------
const PAGE = 50;
const ONLINE_WINDOW_MS = 75_000;
const HEARTBEAT_MS = 30_000;

let me = null;            // { uid, email, name, avatar }
let partner = null;       // { email, name, avatar, uid? }
let currentChatId = null; // "papa_hija" o "papa_amor"
let availableChats = [];  // lista de chats a los que tiene acceso el usuario logueado
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
function resolveEmail(userInput) {
  const norm = userInput.trim().toLowerCase();
  if (norm.includes("@")) return norm;
  // Mapear nombres directos a los correos de Firebase
  if (norm === "papa" || norm === "papá") return "papa@chat-familia.local";
  if (norm === "hija") return "hija@chat-familia.local";
  if (norm === "amor" || norm === "esposa" || norm === "mama" || norm === "mamá") return "amor@chat-familia.local";
  return norm + "@chat-familia.local";
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

  // Descubrir a qué chats tiene acceso este usuario
  availableChats = Object.entries(CHATS)
    .filter(([, cfg]) => cfg.participants.includes(email))
    .map(([id, cfg]) => {
      const pEmail = cfg.participants.find((e) => e !== email);
      return {
        id,
        partnerEmail: pEmail,
        partnerName: FAMILY[pEmail]?.name || "Desconocido",
        partnerAvatar: cachedAvatar(pEmail)
      };
    });

  if (!availableChats.length) {
    signOut(auth);
    return showLogin("No tienes ningún chat asignado.");
  }

  me = { uid: user.uid, email, ...profile, avatar: cachedAvatar(email) };

  // Guardar/recuperar último chat seleccionado
  const savedChat = localStorage.getItem("last_chat_" + email);
  const initialChat = availableChats.find((c) => c.id === savedChat) || availableChats[0];

  selectChat(initialChat.id);
});

function showLogin(msg = "") {
  stopChat();
  chatApp.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  loginBtn.disabled = false;
  loginBtn.textContent = "Entrar";
  loginError.textContent = msg;
  loginError.classList.toggle("hidden", !msg);
  loginPass.value = "";
  if (loginUser) loginUser.focus();
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const userText = loginUser.value.trim();
  if (!userText) return showLogin("Escribe tu nombre de usuario.");
  const email = resolveEmail(userText);

  loginBtn.disabled = true;
  loginBtn.textContent = "Entrando…";
  loginError.classList.add("hidden");
  try {
    await signInWithEmailAndPassword(auth, email, loginPass.value);
    loginPass.value = "";
  } catch (err) {
    console.error(err);
    showLogin(err.code === "auth/too-many-requests"
      ? "Demasiados intentos. Espera unos minutos."
      : "Usuario o clave incorrecta.");
  }
});

logoutBtn.addEventListener("click", async () => {
  if (!confirm("¿Cerrar sesión?")) return;
  await setStatus({ online: false, typing: false }).catch(() => {});
  stopChat();
  await signOut(auth);
});

// ---------- Selector de Chat (si tiene más de 1) ----------
function selectChat(chatId) {
  const target = availableChats.find((c) => c.id === chatId);
  if (!target) return;

  currentChatId = chatId;
  try { localStorage.setItem("last_chat_" + me.email, chatId); } catch {}

  partner = {
    email: target.partnerEmail,
    ...FAMILY[target.partnerEmail],
    avatar: cachedAvatar(target.partnerEmail)
  };

  startChat();
}

if (switchChatBtn) {
  switchChatBtn.addEventListener("click", () => {
    renderChatPicker();
    chatPickerModal.classList.remove("hidden");
  });
}
if (chatPickerClose) {
  chatPickerClose.addEventListener("click", () => chatPickerModal.classList.add("hidden"));
}
if (chatPickerModal) {
  chatPickerModal.addEventListener("click", (e) => {
    if (e.target === chatPickerModal) chatPickerModal.classList.add("hidden");
  });
}

function renderChatPicker() {
  chatPickerGrid.innerHTML = "";
  availableChats.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "profile-btn" + (c.id === currentChatId ? " selected" : "");
    const av = document.createElement("div");
    av.className = "avatar";
    av.textContent = cachedAvatar(c.partnerEmail);
    const name = document.createElement("span");
    name.textContent = c.partnerName;
    b.append(av, name);
    b.addEventListener("click", () => {
      chatPickerModal.classList.add("hidden");
      if (c.id !== currentChatId) selectChat(c.id);
    });
    chatPickerGrid.appendChild(b);
  });
}

// ---------- Chat ----------
function startChat() {
  loginScreen.classList.add("hidden");
  chatApp.classList.remove("hidden");
  partnerNameEl.textContent = partner.name;
  if (welcomeText) welcomeText.textContent = `Chat privado entre ${me.name} y ${partner.name}.`;

  // Mostrar botón de cambiar de chat solo si tiene más de 1 chat (ej. Papá)
  // Para Hija o Amor, este botón queda totalmente oculto.
  if (switchChatBtn) {
    switchChatBtn.classList.toggle("hidden", availableChats.length <= 1);
  }

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
  meBtn.textContent = `Tú: ${me.avatar} ${me.name}`;
}

function subscribeMessages() {
  unsubMessages?.();
  bubbles.clear();
  list.innerHTML = "";
  let first = true;

  // Consulta por fecha (orden natural de Firestore sin requerir índice compuesto)
  // y separamos/mostramos en cliente solo los de este chat.
  // Los mensajes históricos anteriores no tenían chatId: pertenecen al chat con la Hija ("papa_hija").
  const q = query(
    collection(db, "messages"),
    orderBy("createdAt"),
    limitToLast(msgLimit)
  );
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

      // Un mensaje pertenece a este chat si coincide el chatId,
      // o si es un mensaje antiguo sin chatId y estamos en el chat de la Hija ("papa_hija").
      const msgChatId = data.chatId || "papa_hija";
      if (msgChatId !== currentChatId) {
        // Pertenece a otra conversación: no mostrarlo aquí
        if (bubbles.has(id)) {
          bubbles.get(id).remove();
          bubbles.delete(id);
        }
        return;
      }

      if (ch.type === "added") {
        const el = buildBubble(id, data, pending);
        bubbles.set(id, el);
        list.appendChild(el);
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
  if (m.type === "msncard" && m.card) {
    // Si llega una tarjeta interactiva, ¡se abre sola en pantalla automáticamente!
    playMsnCard(m.card, true);
  }

  const body = m.type === "image" ? "📷 Foto"
    : m.type === "msncard" ? `🎁 ${m.card?.titulo || "Te envió una presentación"}`
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
    chatId: currentChatId,
    senderUid: me.uid,
    ...fields,
    createdAt: serverTimestamp(),
    read: false
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
  const isPng = file.type === "image/png";

  for (const maxSide of [1280, 1024, 800, 640]) {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");

    // Si NO es PNG, le ponemos fondo blanco por si era jpeg
    if (!isPng) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);

    // Si es PNG, preservamos transparencia
    if (isPng) {
      const pngData = canvas.toDataURL("image/png");
      if (pngData.length <= LIMIT) return pngData;
    }

    // Para JPG o WebP
    for (const q of [0.8, 0.65, 0.5]) {
      const data = canvas.toDataURL("image/webp", q);
      if (data.startsWith("data:image/webp") && data.length <= LIMIT) return data;
      const dataJpg = canvas.toDataURL("image/jpeg", q);
      if (dataJpg.length <= LIMIT) return dataJpg;
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
// Botón de demostración de presentación Flash (.msncard)
if (btnDemoCard) {
  btnDemoCard.addEventListener("click", () => {
    const demoCard = {
      version: 1,
      titulo: "¡Sorpresa para ti! ✨",
      modo: "fullscreen",
      efecto: "corazones", // "corazones", "confetti" o "estrellas"
      escenas: [
        {
          animacion: "zoom-in",
          texto: "¡Hola! ❤️",
          color: "#ff69b4",
          tamano: 32,
          duracion: 3
        },
        {
          animacion: "flotar",
          texto: "Te preparé esta sorpresa especial ✨",
          color: "#ffd54f",
          tamano: 26,
          duracion: 3.5
        },
        {
          animacion: "latido",
          texto: "¡Eres lo más importante para mí! 💖",
          color: "#ffffff",
          tamano: 30,
          duracion: 4
        }
      ]
    };
    sendMessage({ type: "msncard", card: demoCard });
    playMsnCard(demoCard);
  });
}
btnGames.addEventListener("click", () => openGamesMenu());

// ---------- Enlaces dentro de los mensajes ----------
// Se enlazan solos: "https://…", "www.…" y dominios conocidos sin http://.
// Se construye con nodos del DOM (nunca innerHTML) para que el texto siga siendo seguro.
const LINK_TLDS = "com|net|org|edu|gov|mil|gob|info|biz|cl|ar|mx|pe|co|br|uy|py|bo|ec|ve|es|us|uk|ca|fr|de|it|pt|nl|au|nz|jp|cn|in|ai|io|app|dev|me|tv|cc|xyz|online|site|store|shop|blog|link|ly|gl|be|to|fm|gg|so|sh|ws|page|cloud|tech|news|live|pro|name|mobi|club|top|vip|fit|one|run|fun|wiki|today|world|email|download|stream|icu";
const URL_RE = new RegExp(
  '(?:https?:\\/\\/|www\\.)[^\\s<>"\']+'
  + '|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:' + LINK_TLDS + ')(?::\\d+)?(?:[\\/?#][^\\s<>"\']*)?',
  "gi"
);

// Quita del final la puntuación que pertenece a la frase, no a la URL ("mira https://x.cl.").
function trimUrlEnd(url) {
  let out = url;
  for (;;) {
    const ch = out.slice(-1);
    if (!ch) return out;
    if (",.;:!?…\"'»”’".includes(ch)) { out = out.slice(0, -1); continue; }
    if (ch === ")" && (out.split(")").length - 1) > (out.split("(").length - 1)) { out = out.slice(0, -1); continue; }
    if (ch === "]" && (out.split("]").length - 1) > (out.split("[").length - 1)) { out = out.slice(0, -1); continue; }
    return out;
  }
}

function hrefFor(url) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function appendLinkedText(parent, text) {
  const frag = document.createDocumentFragment();
  let from = 0;
  URL_RE.lastIndex = 0;
  let m;
  while ((m = URL_RE.exec(text))) {
    const prev = m.index > 0 ? text[m.index - 1] : "";
    // No enlazar la parte de un correo (ej. "alguien@gmail.com") ni algo pegado a otra palabra.
    if (prev && (prev === "@" || prev === "." || prev === "-" || prev === "/" || /[a-z0-9_]/i.test(prev))) {
      URL_RE.lastIndex = m.index + m[0].length;
      continue;
    }
    const url = trimUrlEnd(m[0]);
    if (!url) { URL_RE.lastIndex = m.index + m[0].length; continue; }
    if (m.index > from) frag.appendChild(document.createTextNode(text.slice(from, m.index)));
    const a = document.createElement("a");
    a.className = "msg-link";
    a.href = hrefFor(url);
    a.textContent = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.addEventListener("pointerdown", (e) => e.stopPropagation());
    a.addEventListener("click", (e) => e.stopPropagation());
    frag.appendChild(a);
    from = m.index + url.length;
    URL_RE.lastIndex = from;
  }
  if (from < text.length) frag.appendChild(document.createTextNode(text.slice(from)));
  parent.appendChild(frag);
  return frag;
}

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
  } else if (m.type === "msncard" && m.card) {
    el.classList.add("card-bubble");
    const wrap = document.createElement("div");
    wrap.className = "msncard-bubble";
    const icon = document.createElement("div");
    icon.className = "msncard-bubble-icon";
    icon.textContent = "🎁";
    const info = document.createElement("div");
    info.className = "msncard-bubble-info";
    info.innerHTML = `<strong>${escapeHTML(m.card.titulo || "Tarjeta interactiva")}</strong><small>Toca para ver presentación</small>`;
    wrap.append(icon, info);
    wrap.addEventListener("click", () => playMsnCard(m.card));
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
    appendLinkedText(t, text);
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
    if (e.target.closest?.("a")) return; // tocar un enlace no debe abrir las reacciones
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
  el.addEventListener("contextmenu", (e) => {
    if (e.target.closest?.("a")) return; // deja "copiar dirección del enlace"
    e.preventDefault(); showReactionBar(el);
  });
  el.addEventListener("dblclick", (e) => {
    if (e.target.closest?.("a")) return;
    e.preventDefault(); window.getSelection()?.removeAllRanges(); showReactionBar(el);
  });
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
  // Incluimos el email y el chat en el que está escribiendo
  return setDoc(doc(db, "status", me.uid), {
    ...fields,
    email: me.email,
    activeChat: currentChatId,
    lastSeen: serverTimestamp()
  }, { merge: true });
}

function subscribeStatus() {
  unsubStatus?.();
  unsubStatus = onSnapshot(collection(db, "status"), (snap) => {
    const mine = snap.docs.find((d) => d.id === me.uid)?.data();
    
    // Buscar el estado del partner actual:
    // 1) Por coincidencia de email (si ya guardó con email)
    // 2) O por exclusión: si solo hay dos estados (el mío y otro más antiguo que aún no tenía el campo email)
    let other = snap.docs.find((d) => d.data().email === partner.email);
    if (!other) {
      const candidates = snap.docs.filter((d) => d.id !== me.uid);
      // Si solo hay un candidato distinto a mí, es el partner
      if (candidates.length === 1) {
        other = candidates[0];
      } else {
        // Si hay varios candidatos sin email, tomamos el que no tenga email asignado a otra cuenta
        other = candidates.find((d) => !d.data().email || d.data().email === partner.email);
      }
    }
    partnerStatus = other ? other.data({ serverTimestamps: "estimate" }) : null;

    if (mine?.avatar && mine.avatar !== me.avatar) { me.avatar = mine.avatar; cacheAvatar(me.email, mine.avatar); }
    if (partnerStatus?.avatar && partnerStatus.avatar !== partner.avatar) {
      partner.avatar = partnerStatus.avatar;
      cacheAvatar(partner.email, partnerStatus.avatar);
    }
    renderAvatars();
    renderPartnerStatus();

    clearTimeout(typingHideTimer);
    const typingInThisChat = !partnerStatus?.activeChat || partnerStatus.activeChat === currentChatId;
    if (partnerStatus?.typing && typingInThisChat && isPartnerOnline()) {
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
