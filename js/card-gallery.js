// Galería de tarjetas animadas pre-hechas para enviar como .msncard
// Todas usan Canvas dibujado en runtime → fondo transparente

// ─── Dibujadores de figuras en canvas ───────────────────────────────────────

function drawHeartWithEyes(size = 300) {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const ctx = c.getContext("2d");

  const cx = size / 2, cy = size / 2 + size * 0.05;
  const s = size / 300; // escala

  // Corazón rojo/rosa
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy + 90 * s);
  ctx.bezierCurveTo(cx - 5 * s, cy + 75 * s, cx - 80 * s, cy + 30 * s, cx - 80 * s, cy - 20 * s);
  ctx.bezierCurveTo(cx - 80 * s, cy - 70 * s, cx - 20 * s, cy - 90 * s, cx, cy - 50 * s);
  ctx.bezierCurveTo(cx + 20 * s, cy - 90 * s, cx + 80 * s, cy - 70 * s, cx + 80 * s, cy - 20 * s);
  ctx.bezierCurveTo(cx + 80 * s, cy + 30 * s, cx + 5 * s, cy + 75 * s, cx, cy + 90 * s);
  ctx.closePath();

  const grad = ctx.createRadialGradient(cx - 20 * s, cy - 30 * s, 5 * s, cx, cy, 100 * s);
  grad.addColorStop(0, "#ff8fab");
  grad.addColorStop(0.5, "#ff4d77");
  grad.addColorStop(1, "#c1002b");
  ctx.fillStyle = grad;
  ctx.shadowColor = "rgba(255, 50, 100, 0.6)";
  ctx.shadowBlur = 20 * s;
  ctx.fill();
  ctx.restore();

  // Brillo superior izquierdo
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx - 35 * s, cy - 45 * s, 18 * s, 10 * s, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fill();
  ctx.restore();

  // Ojo izquierdo — blanco
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx - 28 * s, cy - 10 * s, 22 * s, 26 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,0.2)";
  ctx.shadowBlur = 5 * s;
  ctx.fill();
  ctx.restore();

  // Ojo derecho — blanco
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx + 28 * s, cy - 10 * s, 22 * s, 26 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,0.2)";
  ctx.shadowBlur = 5 * s;
  ctx.fill();
  ctx.restore();

  // Pupila izquierda
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx - 26 * s, cy - 8 * s, 11 * s, 0, Math.PI * 2);
  ctx.fillStyle = "#1a0030";
  ctx.fill();
  // Brillo pupila
  ctx.beginPath();
  ctx.arc(cx - 20 * s, cy - 14 * s, 4 * s, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.restore();

  // Pupila derecha
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx + 30 * s, cy - 8 * s, 11 * s, 0, Math.PI * 2);
  ctx.fillStyle = "#1a0030";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + 36 * s, cy - 14 * s, 4 * s, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.restore();

  // Boquita
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy + 30 * s, 18 * s, 0.1, Math.PI - 0.1);
  ctx.strokeStyle = "#7a0020";
  ctx.lineWidth = 4 * s;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();

  return c.toDataURL("image/png");
}

function drawStar(size = 300) {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const ctx = c.getContext("2d");
  const cx = size / 2, cy = size / 2;
  const outer = size * 0.44, inner = size * 0.18;
  const spikes = 5;

  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const angle = (i * Math.PI) / spikes - Math.PI / 2;
    ctx[i === 0 ? "moveTo" : "lineTo"](cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(cx, cy - outer * 0.3, 5, cx, cy, outer);
  g.addColorStop(0, "#fffde7");
  g.addColorStop(0.4, "#ffe500");
  g.addColorStop(1, "#ff9800");
  ctx.fillStyle = g;
  ctx.shadowColor = "rgba(255, 220, 0, 0.7)";
  ctx.shadowBlur = 25;
  ctx.fill();
  ctx.restore();

  // Cara de la estrella
  // Ojos
  [[cx - size * 0.1, cy - size * 0.04], [cx + size * 0.1, cy - size * 0.04]].forEach(([ex, ey]) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(ex, ey, size * 0.045, 0, Math.PI * 2);
    ctx.fillStyle = "#333";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + size * 0.015, ey - size * 0.015, size * 0.015, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.restore();
  });
  // Sonrisa
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy + size * 0.06, size * 0.09, 0.1, Math.PI - 0.1);
  ctx.strokeStyle = "#7b5e00";
  ctx.lineWidth = size * 0.02;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();

  return c.toDataURL("image/png");
}

function drawMoon(size = 300) {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const ctx = c.getContext("2d");
  const cx = size / 2, cy = size / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx + size * 0.05, cy, size * 0.4, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(cx, cy - size * 0.1, size * 0.1, cx, cy, size * 0.42);
  g.addColorStop(0, "#fffde7");
  g.addColorStop(0.5, "#ffe066");
  g.addColorStop(1, "#ffc107");
  ctx.fillStyle = g;
  ctx.shadowColor = "rgba(255, 220, 0, 0.5)";
  ctx.shadowBlur = 30;
  ctx.fill();

  // Recorte para forma de luna creciente
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(cx + size * 0.22, cy - size * 0.08, size * 0.33, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Carita
  ctx.save();
  // Ojo
  ctx.beginPath();
  ctx.arc(cx - size * 0.06, cy - size * 0.06, size * 0.04, 0, Math.PI * 2);
  ctx.fillStyle = "#333";
  ctx.fill();
  // Sonrisa
  ctx.beginPath();
  ctx.arc(cx - size * 0.02, cy + size * 0.04, size * 0.07, 0.2, Math.PI - 0.2);
  ctx.strokeStyle = "#7b5e00";
  ctx.lineWidth = size * 0.025;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();

  return c.toDataURL("image/png");
}

function drawRose(size = 300) {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const ctx = c.getContext("2d");
  const cx = size / 2, cy = size * 0.45;

  // Tallo
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy + size * 0.15);
  ctx.quadraticCurveTo(cx + size * 0.08, cy + size * 0.3, cx + size * 0.05, size * 0.92);
  ctx.strokeStyle = "#2e7d32";
  ctx.lineWidth = size * 0.045;
  ctx.lineCap = "round";
  ctx.stroke();
  // Hoja
  ctx.beginPath();
  ctx.ellipse(cx + size * 0.14, cy + size * 0.28, size * 0.1, size * 0.05, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = "#388e3c";
  ctx.fill();
  ctx.restore();

  // Pétalos exteriores
  const petalColors = ["#c62828", "#d32f2f", "#e53935", "#b71c1c", "#e57373"];
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(angle) * size * 0.17;
    const py = cy + Math.sin(angle) * size * 0.17;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(px, py, size * 0.17, size * 0.12, angle, 0, Math.PI * 2);
    ctx.fillStyle = petalColors[i];
    ctx.shadowColor = "rgba(180,0,0,0.3)";
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.restore();
  }
  // Centro de la rosa
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.12, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, size * 0.13);
  g.addColorStop(0, "#ff8a80");
  g.addColorStop(1, "#b71c1c");
  ctx.fillStyle = g;
  ctx.fill();
  // Espiral interior
  ctx.beginPath();
  ctx.arc(cx - size * 0.03, cy - size * 0.02, size * 0.05, -0.5, Math.PI * 0.8);
  ctx.strokeStyle = "rgba(180,0,30,0.5)";
  ctx.lineWidth = size * 0.02;
  ctx.stroke();
  ctx.restore();

  return c.toDataURL("image/png");
}

function drawDiamond(size = 300) {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const ctx = c.getContext("2d");
  const cx = size / 2, cy = size / 2;

  // Facetas del diamante
  const top = { x: cx, y: cy - size * 0.42 };
  const left = { x: cx - size * 0.42, y: cy - size * 0.05 };
  const right = { x: cx + size * 0.42, y: cy - size * 0.05 };
  const bot = { x: cx, y: cy + size * 0.42 };
  const midL = { x: cx - size * 0.25, y: cy - size * 0.05 };
  const midR = { x: cx + size * 0.25, y: cy - size * 0.05 };
  const topL = { x: cx - size * 0.2, y: cy - size * 0.18 };
  const topR = { x: cx + size * 0.2, y: cy - size * 0.18 };

  const facets = [
    { pts: [top, topL, midL, left], color: "#90caf9" },
    { pts: [top, topR, midR, right], color: "#42a5f5" },
    { pts: [top, topL, topR], color: "#bbdefb" },
    { pts: [topL, midL, cx < 0 ? bot : { x: cx, y: cy + size * 0.1 }, topR, midR], color: "#1e88e5" },
    { pts: [midL, left, bot, { x: cx, y: cy + size * 0.1 }], color: "#1565c0" },
    { pts: [midR, right, bot, { x: cx, y: cy + size * 0.1 }], color: "#0d47a1" },
    { pts: [topL, topR, midR, midL], color: "#64b5f6" },
  ];

  ctx.save();
  ctx.shadowColor = "rgba(100, 180, 255, 0.6)";
  ctx.shadowBlur = 30;
  facets.forEach(({ pts, color }) => {
    ctx.beginPath();
    pts.forEach((p, i) => ctx[i === 0 ? "moveTo" : "lineTo"](p.x, p.y));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
  });
  ctx.restore();

  // Brillo
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx - size * 0.05, cy - size * 0.25, size * 0.06, size * 0.03, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fill();
  ctx.restore();

  return c.toDataURL("image/png");
}

// ─── Plantillas de tarjetas ──────────────────────────────────────────────────

function buildTemplates() {
  return [
    {
      id: "corazon-ojitos",
      nombre: "Corazón con ojitos",
      emoji: "❤️",
      card: {
        version: 1,
        titulo: "¡Para ti! ❤️",
        modo: "fullscreen",
        efecto: "corazones",
        escenas: [
          {
            animacion: "zoom-in",
            texto: "Alguien\npiensa mucho\nen ti ✨",
            color: "#ffb3c6",
            tamano: 30,
            duracion: 3,
            imagen: drawHeartWithEyes(340),
          },
          {
            animacion: "latido",
            texto: "❤️",
            color: "#ff4d77",
            tamano: 90,
            duracion: 3,
            imagen: drawHeartWithEyes(340),
          },
          {
            animacion: "flotar",
            texto: "¡Te quiero\nmucho! 💕",
            color: "#ffd6e7",
            tamano: 34,
            duracion: 4,
            imagen: "",
          },
        ],
      },
    },
    {
      id: "estrella-feliz",
      nombre: "Estrella brillante",
      emoji: "⭐",
      card: {
        version: 1,
        titulo: "¡Eres una estrella! ⭐",
        modo: "fullscreen",
        efecto: "estrellas",
        escenas: [
          {
            animacion: "zoom-in",
            texto: "¡Eres\nuna estrella! ⭐",
            color: "#fff9c4",
            tamano: 36,
            duracion: 3,
            imagen: drawStar(320),
          },
          {
            animacion: "flotar",
            texto: "Brillas con\ntu propia luz ✨",
            color: "#ffe066",
            tamano: 30,
            duracion: 4,
            imagen: "",
          },
        ],
      },
    },
    {
      id: "buenas-noches",
      nombre: "Buenas noches",
      emoji: "🌙",
      card: {
        version: 1,
        titulo: "Buenas noches 🌙",
        modo: "fullscreen",
        efecto: "estrellas",
        escenas: [
          {
            animacion: "flotar",
            texto: "Buenas\nnoches 🌙",
            color: "#d0c4f7",
            tamano: 36,
            duracion: 3,
            imagen: drawMoon(320),
          },
          {
            animacion: "zoom-in",
            texto: "Que descanses\nbien 💤",
            color: "#b8a9f0",
            tamano: 30,
            duracion: 3,
            imagen: "",
          },
          {
            animacion: "flotar",
            texto: "✨ Dulces\nsueños ✨",
            color: "#e8d5ff",
            tamano: 32,
            duracion: 4,
            imagen: "",
          },
        ],
      },
    },
    {
      id: "rosa-para-ti",
      nombre: "Una rosa para ti",
      emoji: "🌹",
      card: {
        version: 1,
        titulo: "Una rosa para ti 🌹",
        modo: "fullscreen",
        efecto: "corazones",
        escenas: [
          {
            animacion: "zoom-in",
            texto: "Para ti\ncon cariño 🌹",
            color: "#ffcdd2",
            tamano: 32,
            duracion: 3,
            imagen: drawRose(320),
          },
          {
            animacion: "flotar",
            texto: "Eres tan\nespecial 💕",
            color: "#ff8a80",
            tamano: 32,
            duracion: 4,
            imagen: "",
          },
        ],
      },
    },
    {
      id: "diamante",
      nombre: "Diamante especial",
      emoji: "💎",
      card: {
        version: 1,
        titulo: "¡Eres un diamante! 💎",
        modo: "fullscreen",
        efecto: "estrellas",
        escenas: [
          {
            animacion: "zoom-in",
            texto: "Vales\nmucho 💎",
            color: "#b3e5fc",
            tamano: 36,
            duracion: 3,
            imagen: drawDiamond(320),
          },
          {
            animacion: "flotar",
            texto: "¡Eres\nmuy especial! ✨",
            color: "#e1f5fe",
            tamano: 30,
            duracion: 4,
            imagen: "",
          },
        ],
      },
    },
    {
      id: "feliz-dia",
      nombre: "Feliz día 🎉",
      emoji: "🎉",
      card: {
        version: 1,
        titulo: "¡Feliz día! 🎉",
        modo: "fullscreen",
        efecto: "confetti",
        escenas: [
          {
            animacion: "zoom-in",
            texto: "🎉",
            color: "#fff",
            tamano: 100,
            duracion: 2,
            imagen: "",
          },
          {
            animacion: "flotar",
            texto: "¡Feliz día!\nQue la pases\ngenial 🥳",
            color: "#fff",
            tamano: 32,
            duracion: 4,
            imagen: "",
          },
        ],
      },
    },
    {
      id: "beso",
      nombre: "Un besito 💋",
      emoji: "💋",
      card: {
        version: 1,
        titulo: "Un besito 💋",
        modo: "fullscreen",
        efecto: "corazones",
        escenas: [
          {
            animacion: "latido",
            texto: "💋",
            color: "#ff4d77",
            tamano: 100,
            duracion: 3,
            imagen: "",
          },
          {
            animacion: "flotar",
            texto: "Un besito\npara ti 💕",
            color: "#ffb3c6",
            tamano: 34,
            duracion: 4,
            imagen: "",
          },
        ],
      },
    },
    {
      id: "abrazos",
      nombre: "Muchos abrazos 🤗",
      emoji: "🤗",
      card: {
        version: 1,
        titulo: "¡Muchos abrazos! 🤗",
        modo: "fullscreen",
        efecto: "corazones",
        escenas: [
          {
            animacion: "zoom-in",
            texto: "🤗",
            color: "#ffe0b2",
            tamano: 100,
            duracion: 2,
            imagen: "",
          },
          {
            animacion: "flotar",
            texto: "¡Te mando\nmuchos abrazos! 💛",
            color: "#fff3e0",
            tamano: 32,
            duracion: 4,
            imagen: "",
          },
        ],
      },
    },
  ];
}

// ─── Panel UI ────────────────────────────────────────────────────────────────

let galleryOpen = false;
let galleryEl = null;
let templates = null; // se construye la primera vez (genera las imágenes canvas)

export function openCardGallery({ onSend }) {
  if (galleryOpen) {
    closeCardGallery();
    return;
  }

  // Generar templates la primera vez (es síncrono pero crea canvas)
  if (!templates) templates = buildTemplates();

  galleryOpen = true;

  const panel = document.createElement("div");
  panel.id = "card-gallery-panel";
  panel.className = "card-gallery-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Galería de tarjetas animadas");
  galleryEl = panel;

  panel.innerHTML = `
    <div class="cgp-header">
      <span class="cgp-title">🎁 Tarjetas Animadas</span>
      <button class="cgp-close" title="Cerrar" aria-label="Cerrar galería">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <div class="cgp-grid" role="list" aria-label="Plantillas disponibles">
      ${templates.map(t => `
        <button class="cgp-card" data-id="${t.id}" role="listitem" title="${t.nombre}" aria-label="${t.nombre}">
          <span class="cgp-emoji">${t.emoji}</span>
          <span class="cgp-name">${t.nombre}</span>
        </button>
      `).join("")}
    </div>
    <div class="cgp-footer">
      <button class="cgp-file-btn" id="cgp-load-file">
        <i class="fa-solid fa-folder-open"></i> Cargar desde archivo
      </button>
    </div>
  `;

  // Cerrar con botón X
  panel.querySelector(".cgp-close").addEventListener("click", closeCardGallery);

  // Cerrar al hacer clic fuera del panel
  const onOutsideClick = (e) => {
    if (galleryEl && !galleryEl.contains(e.target)) {
      const sendCardBtn = document.getElementById("btn-send-card");
      if (sendCardBtn && sendCardBtn.contains(e.target)) return;
      closeCardGallery();
    }
  };
  setTimeout(() => document.addEventListener("click", onOutsideClick, { once: true }), 50);

  // Seleccionar plantilla
  panel.querySelectorAll(".cgp-card").forEach(btn => {
    btn.addEventListener("click", () => {
      const tpl = templates.find(t => t.id === btn.dataset.id);
      if (tpl) {
        closeCardGallery();
        onSend(tpl.card);
      }
    });
  });

  // Botón cargar archivo
  panel.querySelector("#cgp-load-file").addEventListener("click", () => {
    closeCardGallery();
    document.getElementById("card-file-input")?.click();
  });

  document.body.appendChild(panel);

  // Animar entrada
  requestAnimationFrame(() => panel.classList.add("cgp-visible"));
}

export function closeCardGallery() {
  if (!galleryEl) return;
  galleryOpen = false;
  galleryEl.classList.remove("cgp-visible");
  const el = galleryEl;
  galleryEl = null;
  setTimeout(() => el.remove(), 260);
}
