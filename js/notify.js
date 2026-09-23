// Notificaciones y service worker

let swReg = null;

export async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    swReg = await navigator.serviceWorker.register("sw.js");
  } catch (e) {
    console.warn("SW no registrado", e);
  }
  return swReg;
}

export function notifSupported() {
  return "Notification" in window;
}

export function notifState() {
  if (!notifSupported()) return "unsupported";
  if (Notification.permission === "granted" && localStorage.getItem("notif_off") === "1") return "off";
  return Notification.permission; // "default" | "granted" | "denied"
}

// Botón 🔔: pide permiso o activa/desactiva
export async function toggleNotifications() {
  if (!notifSupported()) return "unsupported";
  if (Notification.permission === "default") {
    const p = await Notification.requestPermission();
    if (p === "granted") localStorage.removeItem("notif_off");
    return notifState();
  }
  if (Notification.permission === "granted") {
    if (localStorage.getItem("notif_off") === "1") localStorage.removeItem("notif_off");
    else localStorage.setItem("notif_off", "1");
  }
  return notifState();
}

// Muestra una notificación solo si la app no está a la vista
export async function notify(title, body, tag = "chat") {
  if (document.visibilityState === "visible") return;
  if (notifState() !== "granted") return;
  const opts = {
    body,
    tag,
    renotify: true,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    vibrate: [120, 60, 120]
  };
  try {
    const reg = swReg || (await navigator.serviceWorker?.getRegistration());
    if (reg) return reg.showNotification(title, opts);
    new Notification(title, opts);
  } catch (e) {
    console.warn("No se pudo notificar", e);
  }
}

// Sonidito corto (cuando llega un mensaje con la app abierta)
let audioCtx = null;
export function pop() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.08);
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.2);
  } catch {}
}
