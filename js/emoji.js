// Emojis, avatares y utilidades

export const EMOJI_CATS = [
  { icon: "🕘", name: "Recientes", list: [] },
  { icon: "😊", name: "Caritas", list: "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😋 😛 😜 🤪 😝 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 👻 👽 🤖 💩 🤡".split(" ") },
  { icon: "❤️", name: "Corazones", list: "❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 🩷 🩵 💖 💗 💓 💞 💕 💘 💝 💟 ❣️ 💔 ❤️‍🔥 😻 💋 🫶 🤟 🤘 👍 👎 👏 🙌 👐 🤲 🙏 ✌️ 🤞 👌 🤌 👋 🤙 💪 🫡 🫂 ✨ ⭐ 🌟 💫 🔥 💯 🎉".split(" ") },
  { icon: "🐶", name: "Animales", list: "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐻‍❄️ 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦉 🦄 🐝 🦋 🐌 🐞 🐢 🐍 🦖 🦕 🐙 🦑 🦀 🐠 🐟 🐬 🐳 🦈 🦭 🐊 🦒 🐘 🦘 🐑 🐴 🦔 🐾 🌸 🌺 🌻 🌷 🌈 ☀️ 🌙 ⭐ ❄️ ⛄".split(" ") },
  { icon: "🍕", name: "Comida", list: "🍎 🍓 🍉 🍌 🍇 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🌽 🥕 🍟 🍕 🌭 🍔 🥪 🌮 🌯 🍝 🍜 🍣 🍱 🥟 🍗 🥩 🍳 🥞 🧇 🥐 🍞 🧀 🍿 🍩 🍪 🎂 🍰 🧁 🍫 🍬 🍭 🍮 🍦 🍨 🧃 🥤 🧋 ☕ 🍵 🥛".split(" ") },
  { icon: "⚽", name: "Actividades", list: "⚽ 🏀 🏈 ⚾ 🎾 🏐 🏓 🏸 🥅 ⛸️ 🛼 🛹 🚴 🏊 🤸 🧘 🎮 🕹️ 🎲 🧩 ♟️ 🎯 🎳 🎨 🖍️ ✏️ 📚 🎤 🎧 🎸 🎹 🥁 🎬 🎭 🎪 🎡 🎢 🏖️ 🏕️ 🚗 🚲 ✈️ 🚀 🛸 🏠 🏫 🎁 🎈 🎀 🪅 🎃 🎄 🎆".split(" ") },
  { icon: "💡", name: "Objetos", list: "📱 💻 📷 📸 🔦 💡 🕯️ ⏰ ⌛ 📅 📝 📌 📎 ✂️ 🔑 🔒 💌 📦 🛍️ 👑 💍 💎 👓 🕶️ 👕 👗 👟 🎒 ☂️ 🧸 🪀 🪁 🎵 🎶 ✅ ❌ ❓ ❗ 💤 💬 💭 🆗 🆒 🆕 🔔 🏆 🥇 🥈 🥉 🎖️".split(" ") }
];

export const AVATARS = "👨 👧 👩 👦 🧔 👱‍♀️ 👸 🤴 🦸 🦸‍♀️ 🧚 🧜‍♀️ 🧙 🥷 🧑‍🚀 👩‍🎤 🐶 🐱 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐸 🐵 🐧 🦄 🐝 🦋 🐢 🦖 🐙 🐬 🦈 🌸 🌻 🌈 ⭐ 🌙 ⚽ 🎮 🎨 🍓 🍩 🍕 👻 🤖 👽".split(" ");

export const REACTIONS = ["❤️", "😂", "😮", "😢", "👍", "🙏"];

// ---------- Recientes ----------
const RECENT_KEY = "emoji_recent";
function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
}
function pushRecent(e) {
  const r = [e, ...loadRecent().filter((x) => x !== e)].slice(0, 32);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch {}
}

// ---------- ¿Solo emojis? (para mostrarlos grandes) ----------
const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("es", { granularity: "grapheme" }) : null;
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

export function emojiOnlyCount(text) {
  const t = String(text || "").trim();
  if (!t || t.length > 40) return 0;
  const parts = segmenter ? [...segmenter.segment(t)].map((s) => s.segment) : Array.from(t);
  let n = 0;
  for (const g of parts) {
    if (/^\s+$/.test(g)) continue;
    if (!EMOJI_RE.test(g)) return 0;
    n++;
  }
  return n;
}

// ---------- Selector de emojis ----------
export function createEmojiPicker(panel, onPick) {
  panel.innerHTML = "";
  const tabs = document.createElement("div");
  tabs.className = "emoji-tabs";
  const grid = document.createElement("div");
  grid.className = "emoji-grid";
  panel.append(tabs, grid);

  let current = loadRecent().length ? 0 : 1;

  function render() {
    tabs.querySelectorAll("button").forEach((b, i) => b.classList.toggle("active", i === current));
    const listEmojis = current === 0 ? loadRecent() : EMOJI_CATS[current].list;
    grid.innerHTML = "";
    if (!listEmojis.length) {
      const p = document.createElement("p");
      p.className = "emoji-empty";
      p.textContent = "Aquí aparecerán tus emojis más usados";
      grid.appendChild(p);
      return;
    }
    for (const e of listEmojis) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = e;
      b.addEventListener("click", () => { pushRecent(e); onPick(e); });
      grid.appendChild(b);
    }
    grid.scrollTop = 0;
  }

  EMOJI_CATS.forEach((cat, i) => {
    const t = document.createElement("button");
    t.type = "button";
    t.title = cat.name;
    t.textContent = cat.icon;
    t.addEventListener("click", () => { current = i; render(); });
    tabs.appendChild(t);
  });

  return { render };
}

// Inserta texto en la posición del cursor
export function insertAtCursor(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  const pos = start + text.length;
  try { input.setSelectionRange(pos, pos); } catch {}
  input.dispatchEvent(new Event("input"));
}
