import { firebaseConfig, FAMILY, CHATS } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, query, where, orderBy, limit, limitToLast, onSnapshot, doc, setDoc, updateDoc, getDocs,
  writeBatch, serverTimestamp, deleteField, connectFirestoreEmulator, startAfter
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { AVATARS, REACTIONS, emojiOnlyCount, createEmojiPicker, insertAtCursor } from "./emoji.js";
import { registerSW, notify, notifState, toggleNotifications, pop } from "./notify.js";
import { initGames, openGamesMenu, openGame, closeGame } from "./games.js";
import { GAMES } from "./games-logic.js";
import { playMsnCard } from "./msncard.js?v=msncard-alpha-20261025-r2";
import { openCardGallery } from "./card-gallery.js";
import { captureDestination, unreadInChat } from "./workflow.js";
import { loadFailed, saveFailed, removeFailed } from "./send-store.js";

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
const sendBtn = $("send-btn");
const btnAttach = $("btn-attach");
const btnEmoji = $("btn-emoji");
const btnGames = $("btn-games");
const btnSendCard = $("btn-send-card");
const cardFileInput = $("card-file-input");
const emojiPanel = $("emoji-panel");
const fileInput = $("file-input");
const cameraInput = $("camera-input");
const photoModal = $("photo-source-modal");
const lightbox = $("lightbox-modal");
const lightboxImg = $("lightbox-img");
const lightboxDownload = $("lightbox-download");
const toastEl = $("toast");
const reactionBar = $("reaction-bar");
const profileModal = $("profile-modal");
const profileNameInput = $("profile-name");
const profileAvatarEl = $("profile-avatar");
const profileSaveBtn = $("profile-save");
const avatarGrid = $("avatar-grid");
const searchBtn = $("search-btn");
const searchModal = $("search-modal");
const searchInput = $("search-input");
const searchClear = $("search-clear");
const searchMeta = $("search-meta");
const searchResults = $("search-results");
const searchMore = $("search-more");
const albumModal = $("album-modal");
const albumGrid = $("album-grid");
const albumMeta = $("album-meta");
const albumEmpty = $("album-empty");
const micBtn = $("mic-btn");
const dictateBtn = $("btn-dictate");
const recBar = $("rec-bar");
const recTime = $("rec-time");
const recCancel = $("rec-cancel");
const recSend = $("rec-send");
const postalCheck = $("postal-check");
const liveCheck = $("live-check");
const liveEffects = $("live-effects");
const switchChatBtn = $("switch-chat-btn");
const chatPickerModal = $("chat-picker-modal");
const chatPickerClose = $("chat-picker-close");
const chatPickerGrid = $("chat-picker-grid");
const welcomeText = $("welcome-text");
const toolsToggle = $("tools-toggle");
const toolsPanel = $("tools-panel");
function closeTools(restoreFocus = false) {
  toolsPanel.classList.add("hidden");
  toolsToggle.setAttribute("aria-expanded", "false");
  toolsToggle.setAttribute("aria-label", "Abrir funciones");
  if (restoreFocus) toolsToggle.focus();
}
toolsToggle.addEventListener("click", () => {
  const open = toolsPanel.classList.contains("hidden");
  toolsPanel.classList.toggle("hidden", !open);
  toolsToggle.setAttribute("aria-expanded", String(open));
  toolsToggle.setAttribute("aria-label", open ? "Cerrar funciones" : "Abrir funciones");
  emojiPanel.classList.add("hidden");
  if (open) toolsPanel.querySelector(".tools-grid button").focus();
});
$("tools-close").addEventListener("click", () => closeTools(true));
$("tools-album").addEventListener("click", openAlbum);
toolsPanel.addEventListener("click", (event) => {
  if (event.target.closest(".tools-grid button")) closeTools();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !toolsPanel.classList.contains("hidden")) closeTools(true);
});
document.addEventListener("pointerdown", (event) => {
  if (!toolsPanel.contains(event.target) && !toolsToggle.contains(event.target)) closeTools();
});

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
const drafts = new Map();

// ---------- Avatares y nombres guardados ----------
function cachedAvatar(email) {
  try { return localStorage.getItem("avatar_" + email) || FAMILY[email].avatar; } catch { return FAMILY[email].avatar; }
}
function cacheAvatar(email, a) {
  try { localStorage.setItem("avatar_" + email, a); } catch {}
}
function cachedName(email) {
  try { return localStorage.getItem("name_" + email) || FAMILY[email]?.name || "Desconocido"; }
  catch { return FAMILY[email]?.name || "Desconocido"; }
}
function cacheName(email, name) {
  try { localStorage.setItem("name_" + email, name); } catch {}
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
  console.log("🔐 Usuario autenticado:", email, "UID:", user.uid);
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
        partnerName: cachedName(pEmail),
        partnerAvatar: cachedAvatar(pEmail)
      };
    });

  if (!availableChats.length) {
    signOut(auth);
    return showLogin("No tienes ningún chat asignado.");
  }

  me = { uid: user.uid, email, ...profile, name: cachedName(email), avatar: cachedAvatar(email) };

  // Guardar/recuperar último chat seleccionado
  let savedChat;
  try { savedChat = localStorage.getItem("last_chat_" + email); } catch {}
  const initialChat = availableChats.find((c) => c.id === savedChat) || availableChats[0];

  selectChat(initialChat.id);
  loadFailed().then((items) => {
    if (me?.uid !== user.uid) return;
    for (const item of items) {
      if (item.target.uid === me.uid && !failedSends.has(item.id)) failedSends.set(item.id, { ...item, busy: false });
    }
    renderFailedSends();
  }).catch((error) => console.warn("Reintentos disponibles solo durante esta sesión", error));
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
  if (isDictating) stopDictation();
  await setStatus({ online: false, typing: false }).catch(() => {});
  stopChat();
  await signOut(auth);
});

// ---------- Avisos nativos de la app Android ----------
// La notificación fija del APK necesita saber con quién estás chateando para
// mostrar el nombre y el estado correctos (Hija o Amor).
function syncNativeChat() {
  const bridge = window.MensajeroNative;
  if (!bridge || !me || !currentChatId) return;
  try {
    bridge.configure(JSON.stringify(availableChats.map((c) => ({
      id: c.id,
      partnerName: c.partnerName,
      partnerAvatar: cachedAvatar(c.partnerEmail),
      partnerEmail: c.partnerEmail
    }))), currentChatId);
  } catch (e) {
    console.error("No se pudo sincronizar el chat con Android", e);
  }
}

// ---------- Selector de Chat (si tiene más de 1) ----------
function selectChat(chatId) {
  const target = availableChats.find((c) => c.id === chatId);
  if (!target) return;

  if (currentChatId !== chatId) {
    if (currentChatId) drafts.set(`${me.uid}/${currentChatId}`, input.value);
    closeGame();
    closeTextart();
    closeCameraDock();
    if (isDictating) stopDictation();
    input.value = drafts.get(`${me.uid}/${chatId}`) || "";
    keepScrollFromBottom = null;
    unreadHidden = 0;
    partnerStatus = null;
    clearTimeout(typingHideTimer);
    typingIndicator.classList.add("hidden");
  }
  currentChatId = chatId;
  try { localStorage.setItem("last_chat_" + me.email, chatId); } catch {}

  partner = {
    email: target.partnerEmail,
    ...FAMILY[target.partnerEmail],
    name: cachedName(target.partnerEmail),
    avatar: cachedAvatar(target.partnerEmail)
  };

  startChat();
  updateComposerButtons();
  renderFailedSends();
  syncNativeChat();
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
  renderNames();

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
  try { window.MensajeroNative?.chatHidden?.(); } catch {}
  closeTools();
  closeGame();
  if (mediaRecorder) stopRecording(false);
  for (const modal of [albumModal, lightbox, profileModal, searchModal, photoModal, chatPickerModal, emojiPanel]) modal.classList.add("hidden");
  closeTextart();
  closeCameraDock();
  albumGrid.replaceChildren();
  $("failed-sends").replaceChildren();
  $("failed-sends").classList.add("hidden");
  input.value = "";
  currentChatId = null;
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

function renderMeButton() {
  if (!me) return;
  meBtn.replaceChildren();
  const av = document.createElement("span");
  av.className = "me-btn-avatar";
  av.textContent = me.avatar;
  const nm = document.createElement("span");
  nm.className = "me-btn-name";
  nm.textContent = me.name;
  meBtn.append(av, nm);
  meBtn.title = `Mi perfil: ${me.name}`;
}

function renderAvatars() {
  if (!me || !partner) return;
  headerAvatar.textContent = partner.avatar;
  renderMeButton();
  profileAvatarEl.textContent = me.avatar;
}

function renderNames() {
  if (!me || !partner) return;
  partnerNameEl.textContent = partner.name;
  renderMeButton();
  if (welcomeText) welcomeText.textContent = `Chat privado entre ${me.name} y ${partner.name}.`;
  document.title = unreadHidden ? `(${unreadHidden}) Chat con ${partner.name}` : `Chat con ${partner.name}`;

  const c = availableChats.find((x) => x.id === currentChatId);
  if (c) {
    c.partnerName = partner.name;
    c.partnerAvatar = partner.avatar;
  }
  syncNativeChat();
}

function subscribeMessages() {
  unsubMessages?.();
  bubbles.clear();
  list.innerHTML = "";
  let first = true;

  // El servidor filtra antes de limitar; cada conversación tiene su propio historial.
  const q = query(
    collection(db, "messages"),
    where("chatId", "==", currentChatId),
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
    if (searchAfterLoad) {
      searchAfterLoad = false;
      runSearch();
    }
  }, (err) => {
    console.error(err);
    if (err.code === "failed-precondition" && /index/i.test(err.message || "")) {
      toast("No se pudo actualizar el historial: falta crear un índice de Firestore o esperar a que esté listo.");
    } else if (err.code === "permission-denied") {
      toast("No tienes permiso para consultar este chat. Revisa las reglas de Firestore.");
    } else if (err.code === "unavailable") {
      toast("No se pudo conectar con el chat. Revisa tu conexión e inténtalo otra vez.");
    } else {
      toast("No se pudieron cargar los mensajes. Revisa el detalle del error en la consola.");
    }
  });
}

// Mensaje nuevo del otro: sonido / notificación / contador en la pestaña
function incoming(m) {
  if (m.type === "msncard" && m.card) {
    // Si llega una tarjeta interactiva, ¡se abre sola en pantalla automáticamente!
    playMsnCard(m.card, true);
  }

  const body = m.type === "image" ? "📷 Foto"
    : m.type === "audio" ? "🎙️ Nota de voz"
    : m.type === "textart" ? `✨ ${m.text || ""}`
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

// ---------- Buscar mensajes ----------
let searchAfterLoad = false;

function normText(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function messageSearchText(m) {
  const parts = [];
  if (m.type === "image") parts.push("foto imagen");
  else if (m.type === "audio") parts.push("nota de voz audio");
  else if (m.type === "textart") parts.push("texto grande", String(m.text || ""));
  else if (m.type === "msncard") parts.push("presentacion tarjeta", m.card?.titulo || "", m.card?.texto || "");
  else if (m.type === "game") parts.push("juego", GAMES[m.game]?.name || "");
  else parts.push(String(m.text || ""));

  if (m.createdAt?.toDate) {
    const d = m.createdAt.toDate();
    parts.push(formatTime(d));
    parts.push(d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" }));
    parts.push(d.toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" }));
  }
  return normText(parts.join(" "));
}

function messagePreview(m) {
  if (m.type === "image") return "📷 Foto";
  if (m.type === "audio") return "🎙️ Nota de voz";
  if (m.type === "textart") return `✨ ${m.text || ""}`;
  if (m.type === "msncard") return `🎁 ${m.card?.titulo || "Presentación"}`;
  if (m.type === "game") return `🎮 ${GAMES[m.game]?.name || "Juego"}`;
  return String(m.text || "");
}

function messageIcon(m) {
  if (m.type === "image") return "fa-image";
  if (m.type === "audio") return "fa-microphone";
  if (m.type === "textart") return "fa-wand-magic-sparkles";
  if (m.type === "msncard") return "fa-gift";
  if (m.type === "game") return "fa-gamepad";
  return "fa-comment";
}

function appendHighlighted(parent, text, term) {
  const raw = String(text ?? "");
  const hay = normText(raw);
  if (!term) { parent.textContent = raw; return; }
  let from = 0;
  let idx = hay.indexOf(term);
  if (idx === -1) { parent.textContent = raw; return; }
  while (idx !== -1) {
    if (idx > from) parent.appendChild(document.createTextNode(raw.slice(from, idx)));
    const mark = document.createElement("mark");
    mark.textContent = raw.slice(idx, idx + term.length);
    parent.appendChild(mark);
    from = idx + term.length;
    idx = hay.indexOf(term, from);
  }
  if (from < raw.length) parent.appendChild(document.createTextNode(raw.slice(from)));
}

function runSearch() {
  if (!me || !partner) return;
  const term = normText(searchInput.value.trim());
  searchResults.replaceChildren();
  searchMore.classList.add("hidden");
  searchClear.classList.toggle("hidden", !term);

  if (!term) {
    searchMeta.textContent = "Escribe para buscar en esta conversación.";
    return;
  }

  const found = [];
  for (const d of lastDocs) {
    const m = d.data({ serverTimestamps: "estimate" });
    const msgChatId = m.chatId || "papa_hija";
    if (msgChatId !== currentChatId) continue;
    if (!messageSearchText(m).includes(term)) continue;
    found.push({ id: d.id, m });
  }
  found.sort((a, b) => (b.m.createdAt?.toMillis?.() || 0) - (a.m.createdAt?.toMillis?.() || 0));

  searchMeta.textContent = found.length
    ? `${found.length} ${found.length === 1 ? "mensaje encontrado" : "mensajes encontrados"}`
    : "Sin resultados en los mensajes cargados.";

  if (!found.length) {
    const empty = document.createElement("div");
    empty.className = "search-empty";
    const icon = document.createElement("span");
    icon.textContent = "🔍";
    const txt = document.createElement("p");
    txt.textContent = "No encontré esa palabra en esta conversación.";
    empty.append(icon, txt);
    searchResults.appendChild(empty);
  }

  for (const { id, m } of found) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "search-result";

    const icon = document.createElement("span");
    icon.className = "search-result-icon";
    icon.innerHTML = `<i class="fa-solid ${messageIcon(m)}"></i>`;

    const body = document.createElement("span");
    body.className = "search-result-body";

    const top = document.createElement("span");
    top.className = "search-result-top";
    const name = document.createElement("span");
    name.className = "search-result-name";
    name.textContent = m.senderUid === me.uid ? "Tú" : partner.name;
    const time = document.createElement("span");
    time.className = "search-result-time";
    time.textContent = m.createdAt?.toDate ? formatTime(m.createdAt.toDate()) : "";
    top.append(name, time);

    const text = document.createElement("span");
    text.className = "search-result-text";
    appendHighlighted(text, messagePreview(m), term);

    body.append(top, text);
    b.append(icon, body);

    b.addEventListener("click", () => {
      closeSearch();
      const el = bubbles.get(id);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("search-hit");
      void el.offsetWidth;
      el.classList.add("search-hit");
      setTimeout(() => el.classList.remove("search-hit"), 2200);
    });

    searchResults.appendChild(b);
  }

  if (lastDocs.length >= msgLimit) searchMore.classList.remove("hidden");
}

function openSearch() {
  closeCameraDock();
  hidePhotoMenu();
  searchModal.classList.remove("hidden");
  searchInput.value = "";
  runSearch();
  setTimeout(() => searchInput.focus(), 80);
}

function closeSearch() {
  searchModal.classList.add("hidden");
  searchInput.value = "";
  searchResults.replaceChildren();
  searchMore.classList.add("hidden");
}

searchBtn.addEventListener("click", openSearch);
$("search-close").addEventListener("click", closeSearch);
searchModal.addEventListener("click", (e) => { if (e.target === searchModal) closeSearch(); });
searchInput.addEventListener("input", runSearch);
searchClear.addEventListener("click", () => {
  searchInput.value = "";
  runSearch();
  searchInput.focus();
});
searchMore.addEventListener("click", () => {
  searchAfterLoad = true;
  keepScrollFromBottom = container.scrollHeight - container.scrollTop;
  msgLimit += PAGE;
  subscribeMessages();
});

// ---------- Enviar ----------
const failedSends = new Map();
function renderFailedSends() {
  const panel = $("failed-sends");
  panel.replaceChildren();
  for (const [id, item] of failedSends) {
    if (item.target.uid !== me?.uid || item.target.chatId !== currentChatId) continue;
    const row = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = `${item.busy ? "Enviando…" : "No enviado:"} ${messagePreview(item.fields).slice(0, 90)}`;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Reintentar";
    retry.disabled = item.busy;
    retry.addEventListener("click", () => attemptSend(id));
    row.append(label, retry);
    panel.append(row);
  }
  panel.classList.toggle("hidden", !panel.childElementCount);
}

async function attemptSend(id) {
  const item = failedSends.get(id);
  if (!item || item.busy) return false;
  if (me?.uid !== item.target.uid) return false;
  item.busy = true;
  renderFailedSends();
  try {
    // Reutilizar el documento evita duplicados cuando se reintenta.
    await setDoc(doc(db, "messages", id), {
      ...item.fields, chatId: item.target.chatId, senderUid: item.target.uid,
      createdAt: serverTimestamp(), read: false
    });
    failedSends.delete(id);
    await removeFailed(id).catch(console.warn);
    return true;
  } catch (error) {
    console.error(error);
    item.busy = false;
    await saveFailed(id, item).catch(console.warn);
    toast("No se pudo enviar. Puedes reintentarlo en esta conversación.");
    return false;
  } finally {
    renderFailedSends();
  }
}

function sendMessage(fields, target = captureDestination(me, currentChatId)) {
  const ref = doc(collection(db, "messages"));
  failedSends.set(ref.id, { fields, target, busy: false });
  return attemptSend(ref.id);
}

sendForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || !me) return;
  input.value = "";
  updateComposerButtons();
  sendTyping(false);
  sendMessage({ type: "text", text });
});

// ---------- Fotos: modal propio + cámara en vivo ----------
const cameraDock = $("camera-dock");
const cameraBackdrop = $("camera-dock-backdrop");
const cameraVideo = $("camera-video");
const cameraState = $("camera-state");
const cameraFlash = $("camera-flash");
const cameraTitle = $("camera-dock-title");
const cameraStage = $("camera-stage");
const cameraTorchBtn = $("camera-torch");
const cameraZoomBtn = $("camera-zoom");

let camStream = null;
let camFacing = "environment";
let camBusy = false;
let camFailed = false;
let camTorch = false;
let camZoom = 1;

function pickPhoto(inputEl) {
  inputEl._destination = captureDestination(me, currentChatId);
  inputEl.click();
}

function hidePhotoMenu() {
  photoModal.classList.add("hidden");
}

btnAttach.addEventListener("click", () => photoModal.classList.remove("hidden"));

$("photo-source-close").addEventListener("click", hidePhotoMenu);
$("photo-gallery").addEventListener("click", () => {
  hidePhotoMenu();
  pickPhoto(fileInput);
});
$("photo-camera").addEventListener("click", () => {
  hidePhotoMenu();
  openCameraDock();
});
photoModal.addEventListener("click", (e) => {
  if (e.target === photoModal) hidePhotoMenu();
});

// --- Panel de cámara ---
async function openCameraDock() {
  cameraDock.classList.remove("hidden");
  cameraDock.setAttribute("aria-hidden", "false");
  cameraBackdrop.classList.remove("hidden");
  await startCameraStream();
}

function closeCameraDock() {
  stopCameraStream();
  cameraDock.classList.add("hidden");
  cameraDock.setAttribute("aria-hidden", "true");
  cameraBackdrop.classList.add("hidden");
}

function stopCameraStream() {
  if (camStream) {
    for (const track of camStream.getTracks()) track.stop();
    camStream = null;
  }
  cameraVideo.srcObject = null;
  cameraStage.classList.remove("ready");
  camTorch = false;
  cameraTorchBtn.classList.remove("on");
  cameraTorchBtn.classList.add("hidden");
  camZoom = 1;
  updateZoomLabel();
}

function setCameraState(html) {
  if (!html) {
    cameraState.classList.add("hidden");
    return;
  }
  cameraState.innerHTML = html;
  cameraState.classList.remove("hidden");
}

const CAMERA_LOADER =
  '<span class="camera-loader">' +
  '<span class="camera-loader-ring"></span>' +
  '<span class="camera-loader-text">Encendiendo cámara…</span>' +
  '</span>';

// La linterna solo existe en algunas cámaras (casi siempre la trasera).
function updateTorchAvailability() {
  const track = camStream && camStream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : null;
  const tieneLinterna = !!(caps && caps.torch);
  cameraTorchBtn.classList.toggle("hidden", !tieneLinterna);
  if (!tieneLinterna) {
    camTorch = false;
    cameraTorchBtn.classList.remove("on");
  }
}

async function startCameraStream() {
  stopCameraStream();
  camFailed = false;
  cameraStage.classList.remove("ready");
  setCameraState(CAMERA_LOADER);

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    closeCameraDock();
    return pickPhoto(cameraInput);
  }

  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: camFacing,
        width: { ideal: 1440 },
        height: { ideal: 1440 }
      },
      audio: false
    });
    cameraVideo.srcObject = camStream;
    cameraTitle.textContent = camFacing === "user" ? "Cámara frontal" : "Cámara trasera";
    await cameraVideo.play().catch(() => {});

    // Esperamos el primer cuadro para que no se vea el icono de "play" del navegador.
    if (cameraVideo.readyState < 2) {
      await new Promise((resolve) => {
        const listo = () => { cameraVideo.removeEventListener("loadeddata", listo); resolve(); };
        cameraVideo.addEventListener("loadeddata", listo);
        setTimeout(resolve, 1500);
      });
    }

    updateZoomLabel();
    updateTorchAvailability();
    cameraStage.classList.add("ready");
    setCameraState(null);
  } catch (err) {
    console.warn("Cámara no disponible", err);
    camFailed = true;
    cameraTorchBtn.classList.add("hidden");
    const sinPermiso = err && (err.name === "NotAllowedError" || err.name === "SecurityError");
    setCameraState(
      (sinPermiso ? "Falta el permiso de cámara." : "No se pudo abrir la cámara aquí.") +
      "<br><b>Toca el botón blanco para usar la cámara del teléfono.</b>"
    );
  }
}

function captureFrame() {
  const w = cameraVideo.videoWidth;
  const h = cameraVideo.videoHeight;
  if (!w || !h) return Promise.resolve(null);

  // El zoom recorta el centro del cuadro, igual que se ve en pantalla.
  const z = camZoom;
  const sw = w / z;
  const sh = h / z;
  const sx = (w - sw) / 2;
  const sy = (h - sh) / 2;

  const max = 1440;
  const scale = Math.min(1, max / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);

  const ctx = canvas.getContext("2d");
  if (camFacing === "user") {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(cameraVideo, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
}

// --- Linterna ---
async function toggleTorch() {
  const track = camStream && camStream.getVideoTracks()[0];
  if (!track) return;
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  if (!caps || !caps.torch) return toast("Este teléfono no permite la linterna desde aquí.");
  try {
    await track.applyConstraints({ advanced: [{ torch: !camTorch }] });
    camTorch = !camTorch;
    cameraTorchBtn.classList.toggle("on", camTorch);
  } catch (err) {
    console.warn(err);
    toast("No se pudo encender la linterna.");
  }
}

// --- Zoom (pellizco, rueda del mouse o tocando la etiqueta) ---
function updateZoomLabel() {
  cameraZoomBtn.textContent = camZoom.toFixed(1).replace(".0", "") + "×";
  cameraZoomBtn.classList.toggle("zoomed", camZoom > 1.01);
  const mirror = camFacing === "user" ? -1 : 1;
  cameraVideo.style.transform = "scaleX(" + mirror + ") scale(" + camZoom + ")";
}

function setZoom(z) {
  camZoom = Math.min(3, Math.max(1, Math.round(z * 10) / 10));
  updateZoomLabel();
}

let pinchStartDist = 0;
let pinchStartZoom = 1;

function touchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

cameraStage.addEventListener("touchstart", (e) => {
  if (e.touches.length !== 2) return;
  pinchStartDist = touchDistance(e.touches);
  pinchStartZoom = camZoom;
}, { passive: true });

cameraStage.addEventListener("touchmove", (e) => {
  if (e.touches.length !== 2 || !pinchStartDist) return;
  e.preventDefault();
  setZoom(pinchStartZoom * (touchDistance(e.touches) / pinchStartDist));
}, { passive: false });

cameraStage.addEventListener("touchend", () => { pinchStartDist = 0; });
cameraStage.addEventListener("touchcancel", () => { pinchStartDist = 0; });

cameraStage.addEventListener("wheel", (e) => {
  if (cameraDock.classList.contains("hidden")) return;
  e.preventDefault();
  setZoom(camZoom + (e.deltaY < 0 ? 0.25 : -0.25));
}, { passive: false });

cameraZoomBtn.addEventListener("click", () => {
  setZoom(camZoom >= 2.9 ? 1 : camZoom + 1);
});
cameraTorchBtn.addEventListener("click", toggleTorch);

async function onShutter() {
  if (camBusy) return;
  const target = captureDestination(me, currentChatId);

  // Sin vista en vivo usamos la app de cámara del sistema.
  if (!camStream || camFailed) {
    closeCameraDock();
    return pickPhoto(cameraInput);
  }

  camBusy = true;

  // Cámara frontal sin linterna: iluminamos con la pantalla antes de disparar.
  const flashPantalla = camFacing === "user" && !camTorch;
  if (flashPantalla) {
    cameraFlash.classList.add("screen");
    await new Promise((r) => setTimeout(r, 280));
  }

  cameraFlash.classList.remove("on");
  void cameraFlash.offsetWidth;
  cameraFlash.classList.add("on");

  try {
    const blob = await captureFrame();
    if (!blob) throw new Error("sin imagen");
    const file = new File([blob], "foto_" + Date.now() + ".jpg", { type: "image/jpeg" });
    closeCameraDock();
    await sendPhotoFiles([file], target);
  } catch (err) {
    console.error(err);
    toast("No se pudo tomar la foto.");
  } finally {
    cameraFlash.classList.remove("screen");
    camBusy = false;
  }
}

$("camera-shutter").addEventListener("click", onShutter);
$("camera-close").addEventListener("click", closeCameraDock);
cameraBackdrop.addEventListener("click", closeCameraDock);
$("camera-flip").addEventListener("click", async () => {
  camFacing = camFacing === "environment" ? "user" : "environment";
  await startCameraStream();
});
$("camera-gallery").addEventListener("click", () => {
  closeCameraDock();
  pickPhoto(fileInput);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!cameraDock.classList.contains("hidden")) closeCameraDock();
  else if (!textartModal.classList.contains("hidden")) closeTextart();
  else if (!profileModal.classList.contains("hidden")) closeProfile();
  else if (!searchModal.classList.contains("hidden")) closeSearch();
  else if (!albumModal.classList.contains("hidden")) albumModal.classList.add("hidden");
  else if (!photoModal.classList.contains("hidden")) hidePhotoMenu();
});

// Al minimizar la app apagamos la cámara; al volver, la encendemos de nuevo.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (camStream) stopCameraStream();
  } else if (!cameraDock.classList.contains("hidden") && !camStream && !camFailed) {
    startCameraStream();
  }
});

// --- Envío de la foto (comprimida a base64) ---
const MAX_LIVE_SLIDES = 4;

async function sendPhotoFiles(files, target = captureDestination(me, currentChatId)) {
  if (!me) return;
  const list = Array.from(files || []).filter((f) => f && String(f.type).startsWith("image/"));
  if (!list.length) return toast("Solo se pueden enviar fotos.");

  const live = liveCheck.checked;
  const postal = postalCheck.checked;
  const effect = liveEffect === "fade" ? "fade" : "pan";

  try {
    toast(list.length > 1 ? `Preparando ${list.length} fotos…` : "Preparando foto…");

    if (live && list.length > 1) {
      // Varias fotos: una sola postal que las va pasando con fade.
      const picked = list.slice(0, MAX_LIVE_SLIDES);
      const images = [];
      for (const f of picked) images.push(await compressImage(f, { limit: 200_000 }));
      await sendMessage({ type: "image", images, motion: effect, frame: postal }, target);
    } else {
      for (let i = 0; i < list.length; i++) {
        // En la foto viva el marco se dibuja en pantalla, no dentro de la imagen.
        const image = await compressImage(list[i], { postal: live ? false : postal });
        if (live) await sendMessage({ type: "image", image, motion: effect, frame: postal }, target);
        else await sendMessage({ type: "image", image }, target);
        if (i < list.length - 1) await new Promise((r) => setTimeout(r, 250));
      }
    }
    // Cada envío conserva su propio estado y opción de reintento.
  } catch (err) {
    console.error(err);
    toast(list.length > 1 ? "No se pudieron leer esas fotos." : "No se pudo leer esa foto.");
  }
}

async function handlePhotoInput(e) {
  const inputEl = e.currentTarget;
  const files = Array.from(inputEl.files || []);
  inputEl.value = "";
  if (me && files.length) await sendPhotoFiles(files, inputEl._destination || captureDestination(me, currentChatId));
}

fileInput.addEventListener("change", handlePhotoInput);
cameraInput.addEventListener("change", handlePhotoInput);

// ---------- Álbum de fotos del chat ----------
let albumBusy = false;

async function openAlbum() {
  hidePhotoMenu();
  closeCameraDock();
  if (albumBusy) return;
  albumBusy = true;
  albumModal.classList.remove("hidden");
  albumGrid.replaceChildren();
  albumEmpty.classList.add("hidden");
  albumMeta.textContent = "Cargando fotos…";
  const chatId = currentChatId;

  try {
    // Recorrer todas las páginas del chat para no ocultar fotos antiguas.
    const photos = [];
    let cursor = null;
    let more = true;
    while (more) {
      const constraints = [where("chatId", "==", chatId), where("type", "==", "image"), orderBy("createdAt", "desc"), limit(50)];
      if (cursor) constraints.push(startAfter(cursor));
      const snap = await getDocs(query(collection(db, "messages"), ...constraints));
      if (chatId !== currentChatId || albumModal.classList.contains("hidden")) return;
      snap.forEach((d) => {
        const m = d.data({ serverTimestamps: "estimate" });
        if (m.chatId !== chatId) return;
        const list = imageListOf(m);
        if (list.length) photos.push({ m, src: list[0], list, count: list.length });
      });
      cursor = snap.docs.at(-1);
      more = snap.size === 50;
    }

    albumGrid.replaceChildren();
    if (!photos.length) {
      albumMeta.textContent = "Todavía no hay fotos";
      albumEmpty.classList.remove("hidden");
      return;
    }

    albumMeta.textContent = `${photos.length} ${photos.length === 1 ? "foto" : "fotos"}`;
    for (const { m, src, list, count } of photos) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "album-item";
      b.title = count > 1 ? `Ver foto (${count} en la postal viva)` : "Ver foto";

      const img = document.createElement("img");
      img.src = src;
      img.alt = "Foto del chat";
      img.loading = "lazy";
      img.decoding = "async";
      b.appendChild(img);

      if (m.createdAt?.toDate) {
        const date = document.createElement("span");
        date.className = "album-item-date";
        date.textContent = m.createdAt.toDate().toLocaleDateString("es-CL", { day: "2-digit", month: "short" });
        b.appendChild(date);
      }

      if (count > 1) {
        const badge = document.createElement("span");
        badge.className = "album-item-live";
        badge.textContent = `✨ ${count}`;
        b.appendChild(badge);
      }

      b.addEventListener("click", () => openLightbox(src, list));
      albumGrid.appendChild(b);
    }
  } catch (err) {
    console.error(err);
    albumMeta.textContent = "No se pudo cargar el álbum.";
  } finally {
    albumBusy = false;
  }
}

$("album-close").addEventListener("click", () => albumModal.classList.add("hidden"));
albumModal.addEventListener("click", (e) => { if (e.target === albumModal) albumModal.classList.add("hidden"); });
$("photo-album").addEventListener("click", openAlbum);

// La foto postal se guarda como preferencia
try { postalCheck.checked = localStorage.getItem("postal_photos") === "1"; } catch {}
postalCheck.addEventListener("change", () => {
  try { localStorage.setItem("postal_photos", postalCheck.checked ? "1" : "0"); } catch {}
  toast(postalCheck.checked ? "📮 Fotos con marco y fecha activado" : "Fotos normales");
});

// ---------- Foto viva (paneo / fade) ----------
let liveEffect = "pan";
try { liveEffect = localStorage.getItem("live_effect") === "fade" ? "fade" : "pan"; } catch {}

function renderLiveOptions() {
  liveEffects.classList.toggle("hidden", !liveCheck.checked);
  liveEffects.querySelectorAll(".live-chip").forEach((b) => {
    b.classList.toggle("selected", b.dataset.effect === liveEffect);
  });
  const hint = $("live-hint");
  if (hint) {
    hint.textContent = liveEffect === "fade"
      ? "Si eliges varias fotos, se pasan con fade."
      : "La foto se mueve lento, como un recuerdo.";
  }
}

try { liveCheck.checked = localStorage.getItem("live_photos") === "1"; } catch {}
liveCheck.addEventListener("change", () => {
  try { localStorage.setItem("live_photos", liveCheck.checked ? "1" : "0"); } catch {}
  renderLiveOptions();
  if (liveCheck.checked) toast("✨ Fotos vivas activadas");
});
liveEffects.querySelectorAll(".live-chip").forEach((b) => {
  b.addEventListener("click", () => {
    liveEffect = b.dataset.effect === "fade" ? "fade" : "pan";
    try { localStorage.setItem("live_effect", liveEffect); } catch {}
    renderLiveOptions();
  });
});
renderLiveOptions();

// ---------- Texto grande: palabras enviadas como sticker ----------
const textartModal = $("textart-modal");
const textartInput = $("textart-input");
const textartPreview = $("textart-preview");
const textartStylesEl = $("textart-styles");
const textartSendBtn = $("textart-send");
const btnTextart = $("btn-textart");

const TEXTART_STYLES = [
  { id: "neon", name: "Neón" },
  { id: "gold", name: "Oro" },
  { id: "fire", name: "Fuego" },
  { id: "ice", name: "Hielo" },
  { id: "candy", name: "Candy" },
  { id: "glass", name: "Cristal" }
];

let taStyle = "neon";

function textartNode(word, style) {
  const d = document.createElement("div");
  const id = TEXTART_STYLES.some((s) => s.id === style) ? style : "neon";
  d.className = "textart ta-" + id;
  const len = [...word].length;
  const size = len <= 5 ? "52px" : len <= 9 ? "40px" : len <= 14 ? "30px" : "24px";
  d.style.setProperty("--ta-size", size);
  d.textContent = word;
  return d;
}

function renderTextartPreview() {
  const word = textartInput.value.trim();
  textartPreview.replaceChildren();
  if (!word) {
    const hint = document.createElement("span");
    hint.className = "camera-loader-text";
    hint.textContent = "Escribe algo para verlo aquí";
    textartPreview.appendChild(hint);
    textartSendBtn.disabled = true;
    return;
  }
  textartPreview.appendChild(textartNode(word, taStyle));
  textartSendBtn.disabled = false;
}

function buildTextartStyles() {
  textartStylesEl.replaceChildren();
  for (const s of TEXTART_STYLES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ta-chip" + (s.id === taStyle ? " selected" : "");
    b.dataset.style = s.id;
    b.textContent = s.name;
    b.addEventListener("click", () => {
      taStyle = s.id;
      for (const c of textartStylesEl.children) c.classList.toggle("selected", c.dataset.style === taStyle);
      renderTextartPreview();
    });
    textartStylesEl.appendChild(b);
  }
}

function openTextart() {
  textartModal._destination = captureDestination(me, currentChatId);
  const typed = input.value.trim();
  textartModal.classList.remove("hidden");
  textartInput.value = typed;
  renderTextartPreview();
  setTimeout(() => textartInput.focus(), 60);
}

function closeTextart() {
  textartModal.classList.add("hidden");
}

function sendTextart() {
  const word = textartInput.value.trim();
  if (!word || !me) return;
  sendMessage({ type: "textart", text: word, style: taStyle }, textartModal._destination);
  input.value = "";
  updateComposerButtons();
  closeTextart();
}

btnTextart.addEventListener("click", openTextart);
textartInput.addEventListener("input", renderTextartPreview);
textartInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendTextart();
  }
});
$("textart-close").addEventListener("click", closeTextart);
textartSendBtn.addEventListener("click", sendTextart);
textartModal.addEventListener("click", (e) => {
  if (e.target === textartModal) closeTextart();
});

// El compositor conserva el borrador de cada conversación.
function updateComposerButtons() {
  const hasText = input.value.trim().length > 0;
  sendBtn.disabled = !hasText;
  if (me && currentChatId) drafts.set(`${me.uid}/${currentChatId}`, input.value);
}
input.addEventListener("input", updateComposerButtons);

buildTextartStyles();
renderTextartPreview();
updateComposerButtons();

// ---------- Notas de voz ----------
const REC_MAX_MS = 90_000;
let mediaRecorder = null;
let recChunks = [];
let recStream = null;
let recTimer = null;
let recStartedAt = 0;
let recDestination = null;
let requestingMic = false;
let recCancelled = false;
let currentAudio = null;

function fmtDuration(sec) {
  const total = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function pickAudioMime() {
  if (!window.MediaRecorder?.isTypeSupported) return "";
  const options = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus"
  ];
  return options.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

function updateRecTime() {
  const secs = (Date.now() - recStartedAt) / 1000;
  recTime.textContent = fmtDuration(secs);
  if (Date.now() - recStartedAt >= REC_MAX_MS) stopRecording(true);
}

function cleanupRecorder() {
  clearInterval(recTimer);
  recTimer = null;
  mediaRecorder = null;
  recChunks = [];
  if (recStream) {
    for (const track of recStream.getTracks()) track.stop();
    recStream = null;
  }
  micBtn.classList.remove("recording");
  micBtn.innerHTML = '<span>🎙️</span>Nota de voz';
  recBar.classList.add("hidden");
  updateComposerButtons();
}

async function startRecording() {
  if (mediaRecorder || requestingMic || !me) return;
  const target = captureDestination(me, currentChatId);
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    return toast("Este navegador no permite grabar audio.");
  }

  try {
    requestingMic = true;
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.error(err);
    return toast("Falta el permiso de micrófono.");
  } finally {
    requestingMic = false;
  }
  if (me?.uid !== target.uid) { cleanupRecorder(); return; }
  recDestination = target;

  const mime = pickAudioMime();
  try {
    mediaRecorder = new MediaRecorder(recStream, mime
      ? { mimeType: mime, audioBitsPerSecond: 32_000 }
      : { audioBitsPerSecond: 32_000 });
  } catch {
    try { mediaRecorder = new MediaRecorder(recStream); }
    catch { cleanupRecorder(); return toast("No se pudo iniciar la grabación."); }
  }

  recChunks = [];
  recCancelled = false;
  recStartedAt = Date.now();

  mediaRecorder.addEventListener("dataavailable", (e) => {
    if (e.data && e.data.size) recChunks.push(e.data);
  });
  mediaRecorder.addEventListener("stop", onRecorderStop, { once: true });
  try {
    mediaRecorder.start(250);
  } catch {
    cleanupRecorder();
    return toast("No se pudo iniciar la grabación.");
  }

  micBtn.classList.add("recording");
  micBtn.innerHTML = '<span>⏹️</span>Detener grabación';
  recBar.classList.remove("hidden");
  recTime.textContent = "0:00";
  clearInterval(recTimer);
  recTimer = setInterval(updateRecTime, 250);
}

function stopRecording(send = true) {
  if (!mediaRecorder) return;
  recCancelled = !send;
  clearInterval(recTimer);
  recTimer = null;
  if (mediaRecorder.state !== "inactive") {
    try { mediaRecorder.stop(); } catch { cleanupRecorder(); }
  } else {
    cleanupRecorder();
  }
}

async function onRecorderStop() {
  const chunks = recChunks.slice();
  const cancelled = recCancelled;
  const duration = Math.round((Date.now() - recStartedAt) / 1000);
  const target = recDestination;
  cleanupRecorder();

  if (cancelled || !chunks.length) return;
  const blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
  if (blob.size < 900) return toast("La nota quedó muy corta.");

  try {
    const audio = await blobToDataURL(blob);
    if (audio.length > 850_000) return toast("La nota es muy larga. Prueba con una más corta.");
    await sendMessage({ type: "audio", audio, duration }, target);
  } catch (err) {
    console.error(err);
    toast("No se pudo preparar la nota de voz.");
  }
}

function buildAudioPlayer(src, duration) {
  const wrap = document.createElement("div");
  wrap.className = "audio-msg";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "audio-play";
  btn.setAttribute("aria-label", "Reproducir nota de voz");
  btn.innerHTML = '<i class="fa-solid fa-play"></i>';

  const main = document.createElement("div");
  main.className = "audio-main";

  const track = document.createElement("div");
  track.className = "audio-track";
  track.setAttribute("role", "slider");
  track.setAttribute("aria-label", "Avanzar en la nota de voz");
  const fill = document.createElement("div");
  fill.className = "audio-fill";
  const knob = document.createElement("div");
  knob.className = "audio-knob";
  track.append(fill, knob);

  const times = document.createElement("div");
  times.className = "audio-time";
  const cur = document.createElement("span");
  cur.textContent = "0:00";
  const total = document.createElement("span");
  total.textContent = fmtDuration(duration);
  times.append(cur, total);

  main.append(track, times);
  wrap.append(btn, main);

  const audio = new Audio();
  audio.preload = "metadata";
  audio.src = src;

  const knownDuration = () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
    return Number(duration) || 0;
  };

  const setProgress = (pct) => {
    const p = Math.max(0, Math.min(100, pct));
    fill.style.width = p + "%";
    knob.style.left = p + "%";
  };

  const updateIcon = () => {
    const playing = !audio.paused && !audio.ended;
    btn.innerHTML = playing
      ? '<i class="fa-solid fa-pause"></i>'
      : '<i class="fa-solid fa-play"></i>';
    btn.classList.toggle("playing", playing);
    wrap.classList.toggle("playing", playing);
  };

  btn.addEventListener("click", () => {
    if (audio.paused) {
      if (currentAudio && currentAudio !== audio) currentAudio.pause();
      currentAudio = audio;
      audio.play().catch(() => toast("No se pudo reproducir la nota."));
    } else {
      audio.pause();
    }
  });

  audio.addEventListener("play", updateIcon);
  audio.addEventListener("pause", updateIcon);
  audio.addEventListener("ended", () => {
    updateIcon();
    setProgress(0);
    cur.textContent = "0:00";
  });
  audio.addEventListener("loadedmetadata", () => {
    const d = knownDuration();
    if (d) total.textContent = fmtDuration(d);
  });
  audio.addEventListener("timeupdate", () => {
    const d = knownDuration();
    setProgress(d ? (audio.currentTime / d) * 100 : 0);
    cur.textContent = fmtDuration(audio.currentTime);
  });

  track.addEventListener("click", (e) => {
    const d = knownDuration();
    if (!d) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pct * d;
    setProgress(pct * 100);
  });

  return wrap;
}

micBtn.addEventListener("click", () => {
  if (mediaRecorder) stopRecording(true);
  else {
    if (isDictating) stopDictation();
    startRecording();
  }
});
recCancel.addEventListener("click", () => stopRecording(false));
recSend.addEventListener("click", () => stopRecording(true));

// ---------- Dictado por voz (Speech-to-Text) ----------
let recognition = null;
let isDictating = false;
let dictationBaseText = "";

function getRecognition() {
  if (!("SpeechRecognition" in window) && !("webkitSpeechRecognition" in window)) {
    return null;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SpeechRecognition();
  rec.lang = "es-ES";
  rec.interimResults = true;
  rec.continuous = true;
  return rec;
}

function startDictation() {
  if (isDictating || !me) return;
  // Detener grabación de voz si está activa
  if (mediaRecorder) stopRecording(false);
  
  const rec = getRecognition();
  if (!rec) {
    toast("Tu navegador no soporta dictado por voz.");
    return;
  }
  recognition = rec;

  // Guardar el texto base antes de empezar a dictar
  dictationBaseText = input.value;

  recognition.onstart = () => {
    isDictating = true;
    dictateBtn.classList.add("dictating");
    dictateBtn.innerHTML = '<span>⏹️</span>Detener dictado';
    closeTools();
    input.focus();
    toast("🎤 Escuchando... Habla ahora");
  };

  recognition.onresult = (event) => {
    let interimTranscript = "";
    let finalTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript + " ";
      } else {
        interimTranscript += transcript;
      }
    }

    // Construir el texto: base + final + interim
    let newText = dictationBaseText;
    if (finalTranscript) {
      newText += (newText ? " " : "") + finalTranscript;
      // Actualizar la base para que los siguientes resultados se añadan correctamente
      dictationBaseText = newText.trim();
    }
    if (interimTranscript) {
      newText += (newText ? " " : "") + interimTranscript;
    }
    input.value = newText.trim();
    updateComposerButtons();
  };

  recognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error);
    if (event.error !== "no-speech" && event.error !== "aborted") {
      toast("Error en el dictado: " + event.error);
    }
    stopDictation();
  };

  recognition.onend = () => {
    stopDictation();
  };

  try {
    recognition.start();
  } catch (err) {
    console.error("Error starting recognition:", err);
    toast("No se pudo iniciar el dictado");
  }
}

function stopDictation() {
  if (!isDictating) return;
  isDictating = false;
  if (recognition) {
    try { recognition.stop(); } catch {}
    recognition = null;
  }
  dictateBtn.classList.remove("dictating");
  dictateBtn.innerHTML = '<span>🗣️</span>Dictado';
  dictationBaseText = "";
}

dictateBtn.addEventListener("click", () => {
  if (isDictating) stopDictation();
  else startDictation();
});

// Detener dictado si se cierra el panel de herramientas o se cambia de chat
const originalCloseTools = closeTools;
closeTools = function(restoreFocus = false) {
  if (isDictating) stopDictation();
  return originalCloseTools(restoreFocus);
};

async function compressImage(file, { postal = false, limit: LIMIT = 700_000 } = {}) {
  const img = await loadImage(file);
  const isPng = file.type === "image/png";
  const takenAt = new Date();

  for (const maxSide of [1280, 1024, 800, 640]) {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");

    if (postal) {
      drawPostal(ctx, img, w, h, takenAt);
    } else {
      // Si NO es PNG, le ponemos fondo blanco por si era jpeg
      if (!isPng) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(img, 0, 0, w, h);
    }

    // Si es PNG (y no es postal), preservamos transparencia
    if (isPng && !postal) {
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

// Marco blanco estilo postal + fecha y hora estampadas abajo.
function drawPostal(ctx, img, w, h, when) {
  const short = Math.min(w, h);
  const pad = Math.max(10, Math.round(short * 0.045));
  const band = Math.max(38, Math.round(short * 0.13));
  const innerW = w - pad * 2;
  const innerH = h - pad * 2 - band;

  ctx.fillStyle = "#fdfcf7";
  ctx.fillRect(0, 0, w, h);

  // Recorte tipo "cover" para que la foto llene el marco sin deformarse.
  const scale = Math.max(innerW / img.width, innerH / img.height);
  const sw = innerW / scale;
  const sh = innerH / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, pad, pad, innerW, innerH);

  const dateStr = when.toLocaleDateString("es-CL", {
    day: "2-digit", month: "short", year: "numeric"
  }).replace(".", "").toUpperCase();
  const timeStr = when.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  const fs = Math.max(11, Math.round(short * 0.036));
  const baseY = pad + innerH + band / 2;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = "#00a884";
  ctx.fillRect(w / 2 - fs * 1.1, baseY - fs * 1.05, fs * 2.2, Math.max(2, Math.round(fs * 0.1)));

  ctx.fillStyle = "#4a4a45";
  ctx.font = `600 ${fs}px "Segoe UI", system-ui, -apple-system, sans-serif`;
  ctx.fillText(`${dateStr}  ·  ${timeStr}`, w / 2, baseY + fs * 0.25);
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
  destination: () => captureDestination(me, currentChatId),
  toast,
  notify,
  sendInvite: (game, gameId, target) => sendMessage({ type: "game", game, gameId }, target)
});
// Botón 🎁 — abre la galería de tarjetas animadas
if (btnSendCard) {
  btnSendCard.addEventListener("click", () => {
    const target = captureDestination(me, currentChatId);
    openCardGallery({
      onSend: async (cardData) => {
        if (await sendMessage({ type: "msncard", card: cardData }, target)) {
          playMsnCard(cardData);
          toast("¡Presentación enviada! 🎁");
        }
      }
    });
  });
}

// Input oculto para cargar archivo .msncard desde disco (usado por "Cargar desde archivo" en la galería)
if (cardFileInput) {
  cardFileInput.addEventListener("change", async () => {
    const file = cardFileInput.files[0];
    cardFileInput.value = "";
    if (!file || !me) return;
    const target = captureDestination(me, currentChatId);

    if (file.size > 950_000) {
      toast("El archivo supera el límite de Firebase (~950 KB). Reduce la duración o resolución.");
      return;
    }

    try {
      const text = await file.text();
      const cardData = JSON.parse(text);

      if (!cardData || typeof cardData !== "object" || (!cardData.video && (!Array.isArray(cardData.escenas) || cardData.escenas.length === 0))) {
        toast("El archivo no es una presentación o video .msncard válido.");
        return;
      }

      if (await sendMessage({ type: "msncard", card: cardData }, target)) {
        toast("¡Presentación enviada! 🎁");
        playMsnCard(cardData);
      }
    } catch (err) {
      console.error(err);
      toast("No se pudo leer el archivo. Asegúrate que sea un .msncard o JSON válido.");
    }
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

// ---------- Fotos vivas (paneo / fade) ----------
function imageListOf(m) {
  const ok = (s) => typeof s === "string" && s.startsWith("data:image/");
  const arr = Array.isArray(m.images) ? m.images.filter(ok) : [];
  if (arr.length) return arr;
  return ok(m.image) ? [m.image] : [];
}

function postalStamp(ts) {
  const d = ts && typeof ts.toDate === "function" ? ts.toDate() : new Date();
  const date = d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" })
    .replace(/\./g, "")
    .toUpperCase();
  const time = d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: true })
    .replace(/\u202f|\u00a0/g, " ")
    .replace(/\s?([ap])\.?\s?m\.?$/i, " $1. m.");
  return `${date} · ${time}`;
}

const LIVE_SLIDE_MS = 4200;
let liveTimer = null;
let liveSeq = 0;

// Un solo temporizador para todas las postales con varias fotos.
function startLiveSlideshow() {
  if (liveTimer) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  liveTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    document.querySelectorAll(".live-photo.slideshow").forEach((box) => {
      const imgs = box.querySelectorAll(".live-img");
      if (imgs.length < 2) return;
      const next = (Number(box.dataset.index || 0) + 1) % imgs.length;
      box.dataset.index = String(next);
      imgs.forEach((im, i) => im.classList.toggle("on", i === next));
    });
  }, LIVE_SLIDE_MS);
}

function buildLivePhoto(m, list, bubble) {
  const motion = m.motion === "fade" ? "fade" : "pan";
  const framed = !!m.frame;

  const box = document.createElement("div");
  box.className = "live-photo" + (framed ? " framed" : "") + (list.length > 1 ? " slideshow" : "");
  box.dataset.motion = motion;
  box.dataset.index = "0";
  if (liveSeq++ % 2) box.classList.add("rev");

  const win = document.createElement("div");
  win.className = "live-window";

  list.forEach((src, i) => {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "Foto";
    img.decoding = "async";
    img.className = "live-img" + (i === 0 ? " on" : "");
    if (i === 0) {
      img.addEventListener("load", () => {
        if (img.naturalWidth && img.naturalHeight) {
          const r = img.naturalWidth / img.naturalHeight;
          win.style.aspectRatio = r < 0.72 ? "3 / 4" : r > 1.9 ? "16 / 9" : `${img.naturalWidth} / ${img.naturalHeight}`;
        }
        if (isNearBottom(400)) scrollToBottom();
      });
    }
    win.appendChild(img);
  });

  box.appendChild(win);

  if (framed) {
    const date = document.createElement("div");
    date.className = "live-date";
    date.textContent = postalStamp(m.createdAt);
    box.appendChild(date);
  }

  if (list.length > 1) startLiveSlideshow();

  box.addEventListener("click", () => {
    if (bubble && bubble._longPressed) return;
    openLightbox(list[0], list);
  });

  return box;
}

// ---------- Burbujas (sin innerHTML con datos del usuario) ----------
function buildBubble(id, m, pending) {
  const isMine = m.senderUid === me.uid;
  const el = document.createElement("div");
  el.className = `message-bubble ${isMine ? "sent" : "received"}`;
  el.dataset.id = id;

  const photos = m.type === "image" ? imageListOf(m) : [];
  if (m.type === "image" && photos.length && m.motion) {
    el.classList.add("live-bubble");
    el.appendChild(buildLivePhoto(m, photos, el));
  } else if (m.type === "image" && photos.length) {
    const wrap = document.createElement("div");
    wrap.className = "img-msg-container";
    const img = document.createElement("img");
    img.src = photos[0];
    img.alt = "Foto";
    img.decoding = "async";
    img.addEventListener("load", () => { if (isNearBottom(400)) scrollToBottom(); });
    wrap.addEventListener("click", () => { if (!el._longPressed) openLightbox(photos[0]); });
    wrap.appendChild(img);
    el.appendChild(wrap);
  } else if (m.type === "audio" && typeof m.audio === "string" && m.audio.startsWith("data:audio/")) {
    el.appendChild(buildAudioPlayer(m.audio, m.duration));
  } else if (m.type === "msncard" && m.card) {
    el.classList.add("card-bubble");
    const wrap = document.createElement("div");
    wrap.className = "msncard-bubble";
    const icon = document.createElement("div");
    icon.className = "msncard-bubble-icon";
    icon.textContent = "🎁";
    const info = document.createElement("div");
    info.className = "msncard-bubble-info";
    const strong = document.createElement("strong");
    strong.textContent = m.card.titulo || "Tarjeta interactiva";
    const small = document.createElement("small");
    small.textContent = "Toca para ver presentación";
    info.append(strong, small);
    wrap.append(icon, info);
    wrap.addEventListener("click", () => playMsnCard(m.card));
    el.appendChild(wrap);
  } else if (m.type === "textart" && m.text) {
    el.classList.add("textart-bubble");
    el.appendChild(textartNode(String(m.text), m.style));
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
  const unread = unreadInChat(lastDocs, me.uid, currentChatId).slice(0, 450);
  const chatId = currentChatId;
  const acknowledge = () => {
    if (currentChatId !== chatId || document.visibilityState !== "visible") return;
    try { window.MensajeroNative?.messagesRead?.(chatId); } catch {}
  };
  if (!unread.length) { acknowledge(); return; }
  const batch = writeBatch(db);
  unread.forEach((d) => batch.update(d.ref, { read: true }));
  batch.commit().then(acknowledge).catch((e) => console.error(e));
}

// ---------- Mi perfil (nombre + avatar) ----------
let profileAvatarChoice = null;

function openProfile() {
  if (!me) return;
  closeCameraDock();
  hidePhotoMenu();
  profileAvatarChoice = me.avatar;
  profileNameInput.value = me.name;
  profileAvatarEl.textContent = me.avatar;
  avatarGrid.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("selected", b.textContent === me.avatar);
  });
  profileModal.classList.remove("hidden");
  setTimeout(() => profileNameInput.focus(), 80);
}

function closeProfile() {
  profileModal.classList.add("hidden");
}

function saveProfile() {
  if (!me) return;
  const name = profileNameInput.value.trim().replace(/\s+/g, " ").slice(0, 24);
  if (!name) {
    toast("Escribe tu nombre.");
    profileNameInput.focus();
    return;
  }

  me.name = name;
  me.avatar = profileAvatarChoice || me.avatar;
  cacheName(me.email, name);
  cacheAvatar(me.email, me.avatar);

  renderAvatars();
  renderNames();
  setStatus({ name, avatar: me.avatar }).catch(() => {});

  closeProfile();
  toast("Perfil actualizado ✨");
}

AVATARS.forEach((a) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = a;
  b.addEventListener("click", () => {
    if (!me) return;
    profileAvatarChoice = a;
    profileAvatarEl.textContent = a;
    avatarGrid.querySelectorAll("button").forEach((x) => x.classList.toggle("selected", x === b));
  });
  avatarGrid.appendChild(b);
});

meBtn.addEventListener("click", openProfile);
profileSaveBtn.addEventListener("click", saveProfile);
$("profile-close").addEventListener("click", closeProfile);
profileModal.addEventListener("click", (e) => { if (e.target === profileModal) closeProfile(); });
profileNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); saveProfile(); }
});

// ---------- En línea / escribiendo ----------
function setStatus(fields) {
  if (!me) return Promise.resolve();
  // Incluimos el email y el chat en el que está escribiendo
  return setDoc(doc(db, "status", me.uid), {
    ...fields,
    name: me.name,
    email: me.email,
    activeChat: currentChatId,
    lastSeen: serverTimestamp()
  }, { merge: true });
}

function subscribeStatus() {
  unsubStatus?.();
  unsubStatus = onSnapshot(collection(db, "status"), (snap) => {
    const mine = snap.docs.find((d) => d.id === me.uid)?.data();
    
    // Con tres cuentas, inferir por exclusión puede mostrar a la persona equivocada.
    const other = snap.docs.find((d) => d.data().email === partner.email);
    partnerStatus = other ? other.data({ serverTimestamps: "estimate" }) : null;

    if (mine?.avatar && mine.avatar !== me.avatar) { me.avatar = mine.avatar; cacheAvatar(me.email, mine.avatar); }
    if (mine?.name && mine.name !== me.name) { me.name = mine.name; cacheName(me.email, mine.name); }
    if (partnerStatus?.avatar && partnerStatus.avatar !== partner.avatar) {
      partner.avatar = partnerStatus.avatar;
      cacheAvatar(partner.email, partnerStatus.avatar);
    }
    if (partnerStatus?.name && partnerStatus.name !== partner.name) {
      partner.name = partnerStatus.name;
      cacheName(partner.email, partnerStatus.name);
    }
    renderAvatars();
    renderNames();
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
    ? '<i class="fa-solid fa-bell" aria-hidden="true"></i> Desactivar avisos'
    : '<i class="fa-solid fa-bell-slash" aria-hidden="true"></i> Activar avisos';
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
let lightboxList = [];
let lightboxIndex = 0;

function openLightbox(src, list) {
  lightboxList = Array.isArray(list) && list.length ? list : [src];
  lightboxIndex = Math.max(0, lightboxList.indexOf(src));
  lightboxImg.src = lightboxList[lightboxIndex];
  lightboxDownload.href = lightboxImg.src;
  lightbox.classList.remove("hidden");
}

// Si la postal trae varias fotos, tocando la imagen se pasa a la siguiente.
lightboxImg.addEventListener("click", (e) => {
  if (lightboxList.length < 2) return;
  e.stopPropagation();
  lightboxIndex = (lightboxIndex + 1) % lightboxList.length;
  lightboxImg.src = lightboxList[lightboxIndex];
  lightboxDownload.href = lightboxImg.src;
});
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
