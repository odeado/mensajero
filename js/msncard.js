// Reproductor de Animaciones / Presentaciones Flash (.msncard)
export function playMsnCard(cardData, isAuto = false) {
  if (!cardData || typeof cardData !== "object") return;

  // Si ya hay una abierta, cerrarla
  closeMsnCard();

  const overlay = document.createElement("div");
  overlay.id = "msncard-player";
  overlay.className = "msncard-overlay";

  const closeBtn = document.createElement("button");
  closeBtn.className = "msncard-close";
  closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
  closeBtn.title = "Cerrar presentación";
  closeBtn.onclick = closeMsnCard;

  const contentBox = document.createElement("div");
  contentBox.className = "msncard-stage";

  // Efectos de fondo (partículas flotantes de corazones, estrellas o fiesta)
  const particlesCanvas = document.createElement("canvas");
  particlesCanvas.className = "msncard-particles";

  overlay.append(particlesCanvas, closeBtn, contentBox);
  document.body.appendChild(overlay);

  // Iniciar animación de partículas de fondo
  startParticles(particlesCanvas, cardData.efecto || "corazones");

  // Reproducir sonido si incluye audio sintético o base64 (solo si no es un video con su propio audio)
  if (!cardData.video) {
    playCardSound(cardData.efecto);
  }

  // Si la tarjeta contiene un video renderizado (exportado desde el editor de video)
  if (cardData.video) {
    contentBox.innerHTML = `
      <div class="msncard-scene anim-zoom-in msncard-video-wrap">
        <div class="msncard-title" style="margin-bottom:14px;">${escapeHtml(cardData.titulo || "¡Presentación para ti! ✨")}</div>
        <video class="msncard-video" src="${cardData.video}" autoplay playsinline controls></video>
      </div>
    `;
    const vid = contentBox.querySelector("video");
    if (vid) {
      vid.onended = () => {
        contentBox.innerHTML = `
          <div class="msncard-scene end-scene">
            <div class="msncard-title">${escapeHtml(cardData.titulo || "Fin ✨")}</div>
            <button type="button" class="g-btn" id="msncard-replay"><i class="fa-solid fa-rotate-right"></i> Ver de nuevo</button>
          </div>
        `;
        const rep = contentBox.querySelector("#msncard-replay");
        if (rep) rep.onclick = () => playMsnCard(cardData);
      };
      vid.play().catch(() => {});
    }
    return;
  }

  // Escenas secuenciales
  const escenas = Array.isArray(cardData.escenas) ? cardData.escenas : [];
  let currentIdx = 0;

  // Indicador de progreso (puntitos abajo)
  const dotsBar = document.createElement("div");
  dotsBar.className = "msncard-dots";
  overlay.appendChild(dotsBar);

  function renderDots(active) {
    dotsBar.innerHTML = "";
    escenas.forEach((_, i) => {
      const dot = document.createElement("span");
      dot.className = "msncard-dot" + (i === active ? " active" : "");
      dotsBar.appendChild(dot);
    });
  }

  function showScene(idx) {
    if (idx >= escenas.length) {
      // Fin de la presentación: mostrar botón para repetir
      dotsBar.innerHTML = "";
      contentBox.innerHTML = `
        <div class="msncard-scene end-scene">
          <div class="msncard-title">${escapeHtml(cardData.titulo || "Fin ✨")}</div>
          <button type="button" class="g-btn" id="msncard-replay"><i class="fa-solid fa-rotate-right"></i> Ver de nuevo</button>
        </div>
      `;
      const replay = contentBox.querySelector("#msncard-replay");
      if (replay) replay.onclick = () => showScene(0);
      return;
    }

    renderDots(idx);

    const esc = escenas[idx];

    // Fade-out del contenido anterior antes de cambiar
    const oldScene = contentBox.querySelector(".msncard-scene");
    if (oldScene) {
      oldScene.classList.add("fade-out");
      setTimeout(() => buildScene(esc, idx), 350);
    } else {
      buildScene(esc, idx);
    }
  }

  function buildScene(esc, idx) {
    contentBox.innerHTML = "";

    const sceneEl = document.createElement("div");
    sceneEl.className = `msncard-scene anim-${esc.animacion || "zoom-in"}`;

    if (esc.imagen) {
      const img = document.createElement("img");
      img.src = esc.imagen;
      img.className = "msncard-img";
      sceneEl.appendChild(img);
    }

    if (esc.texto) {
      const txt = document.createElement("div");
      txt.className = "msncard-text";
      txt.textContent = esc.texto;
      if (esc.color) txt.style.color = esc.color;
      if (esc.tamano) txt.style.fontSize = esc.tamano + "px";
      sceneEl.appendChild(txt);
    }

    contentBox.appendChild(sceneEl);

    // Duración de esta escena (por defecto 3.5 segundos)
    const duracion = (esc.duracion || 3.5) * 1000;
    sceneTimeout = setTimeout(() => showScene(idx + 1), duracion);
  }

  showScene(0);
}

let sceneTimeout = null;
let animFrameId = null;

export function closeMsnCard() {
  if (sceneTimeout) clearTimeout(sceneTimeout);
  if (animFrameId) cancelAnimationFrame(animFrameId);
  const el = document.getElementById("msncard-player");
  if (el) el.remove();
}

function startParticles(canvas, tipo) {
  const ctx = canvas.getContext("2d");
  let w = (canvas.width = window.innerWidth);
  let h = (canvas.height = window.innerHeight);

  const icons = tipo === "confetti" ? ["🎉", "🎊", "✨", "🟡", "🟣", "🟢"]
    : tipo === "estrellas" ? ["⭐", "✨", "🌟", "💫"]
    : ["❤️", "💖", "💕", "🌸", "✨"];

  // Velocidades en píxeles/segundo (normalizado a 60fps de base)
  const particles = Array.from({ length: 28 }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    size: 16 + Math.random() * 22,
    speedY: (55 + Math.random() * 90),   // px/s  (≈1-2.5 px/frame @60fps)
    speedX: (Math.random() - 0.5) * 60,  // px/s
    rot: Math.random() * 360,
    rotSpeed: (Math.random() - 0.5) * 120, // grados/s
    char: icons[Math.floor(Math.random() * icons.length)]
  }));

  let lastTime = performance.now();

  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1); // segundos, máx 100ms
    lastTime = now;

    ctx.clearRect(0, 0, w, h);
    particles.forEach((p) => {
      p.y += p.speedY * dt;
      p.x += p.speedX * dt;
      p.rot += p.rotSpeed * dt;
      if (p.y > h + 30) {
        p.y = -20;
        p.x = Math.random() * w;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.font = `${p.size}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.char, 0, 0);
      ctx.restore();
    });
    animFrameId = requestAnimationFrame(loop);
  }
  animFrameId = requestAnimationFrame(loop);
}

// Genera un tono musical suave con Web Audio API (sin descargar archivos de audio)
function playCardSound(tipo) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = tipo === "confetti" ? [523.25, 659.25, 783.99, 1046.5] : [440, 554.37, 659.25, 880];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.08, ctx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.15);
      osc.stop(ctx.currentTime + i * 0.15 + 0.6);
    });
  } catch (e) {}
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
