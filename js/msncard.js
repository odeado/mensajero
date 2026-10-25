// Reproductor de Animaciones / Presentaciones Flash (.msncard)
export function playMsnCard(cardData, isAuto = false) {
  if (!cardData || typeof cardData !== "object") return;

  // Si ya hay una abierta, cerrarla
  closeMsnCard();

  const overlay = document.createElement("div");
  overlay.id = "msncard-player";
  overlay.className = "msncard-overlay";

  // Modo sin fondo: la figura flota sobre el chat sin overlay oscuro
  if (cardData.fondo === "transparente") {
    overlay.classList.add("msncard-sin-fondo");
  }

  const closeBtn = document.createElement("button");
  closeBtn.className = "msncard-close";
  closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
  closeBtn.title = "Cerrar presentación";
  closeBtn.onclick = closeMsnCard;

  // Ocultar botón cerrar en tarjetas de galería (se cierran solas al terminar)
  if (cardData.fondo === "transparente") {
    closeBtn.style.display = "none";
  }

  // Si la tarjeta contiene un video renderizado (exportado desde el editor de video)
  // Mostrar exclusivamente el video limpio sin fondos, marcos ni textos ajenos al video
  if (cardData.video) {
    overlay.className = "msncard-overlay msncard-video-overlay";
    if(cardData.transparencia === "alpha-split-v1"){playTransparentCard(overlay,closeBtn,cardData);return;}
    const vidWrap = document.createElement("div");
    vidWrap.className = "msncard-video-full";
    const playerVideo=document.createElement('video');playerVideo.className='msncard-player-video';playerVideo.src=cardData.video;playerVideo.autoplay=true;playerVideo.playsInline=true;playerVideo.controls=true;vidWrap.append(playerVideo);
    overlay.append(closeBtn, vidWrap);
    document.body.appendChild(overlay);

    // Efecto de partículas solo si se configuró explícitamente y no es "ninguno"
    if (cardData.efecto && cardData.efecto !== "ninguno") {
      const particlesCanvas = document.createElement("canvas");
      particlesCanvas.className = "msncard-particles";
      overlay.insertBefore(particlesCanvas, vidWrap);
      startParticles(particlesCanvas, cardData.efecto);
    }

    const vid = vidWrap.querySelector("video");
    if (vid) {
      activeCardVideo=vid;
      vid.play().catch(() => {});
    }
    return;
  }

  const contentBox = document.createElement("div");
  contentBox.className = "msncard-stage";

  // Efectos de fondo (partículas flotantes de corazones, estrellas o fiesta)
  const particlesCanvas = document.createElement("canvas");
  particlesCanvas.className = "msncard-particles";

  overlay.append(particlesCanvas, closeBtn, contentBox);
  document.body.appendChild(overlay);

  // Iniciar animación de partículas de fondo
  startParticles(particlesCanvas, cardData.efecto || "corazones");

  // Reproducir sonido si incluye audio sintético o base64
  playCardSound(cardData.efecto);

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
      // Fin: fade out y cerrar automáticamente
      overlay.style.transition = "opacity 0.6s ease";
      overlay.style.opacity = "0";
      setTimeout(() => closeMsnCard(), 650);
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

let activeCardVideo = null;
let videoFrameId = null;
let sceneTimeout = null;
let animFrameId = null;

export function closeMsnCard() {
  if(videoFrameId)cancelAnimationFrame(videoFrameId);videoFrameId=null;
  if(activeCardVideo){activeCardVideo.pause();activeCardVideo.removeAttribute("src");activeCardVideo.load();activeCardVideo=null;}
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

// alpha-split-v1 stores RGB above a grayscale opacity mask in one H.264 video.
function playTransparentCard(overlay,closeBtn,cardData){
 overlay.classList.add('msncard-transparent');
 const wrap=document.createElement('div');wrap.className='msncard-video-full';
 const canvas=document.createElement('canvas');canvas.className='msncard-alpha-canvas';
 const video=document.createElement('video');video.className='msncard-alpha-source';video.playsInline=true;video.setAttribute('playsinline','');video.src=cardData.video;video.preload='auto';activeCardVideo=video;
 const toggle=document.createElement('button');toggle.className='msncard-video-toggle';toggle.type='button';toggle.textContent='Reproducir';
 const scratch=document.createElement('canvas'),sg=scratch.getContext('2d',{willReadFrequently:true}),g=canvas.getContext('2d');let last=-1;
 toggle.onclick=()=>{if(video.paused)video.play().catch(()=>{toggle.textContent='Reproducir';});else video.pause();};
 video.onplay=()=>{toggle.textContent='Pausar';};video.onpause=()=>{toggle.textContent='Reproducir';};video.onended=()=>{toggle.textContent='Repetir';};
 video.onloadedmetadata=()=>{const ratio=Math.min(1,960/video.videoWidth,960/(video.videoHeight/2)),w=Math.max(2,Math.round(video.videoWidth*ratio)),h=Math.max(2,Math.round(video.videoHeight/2*ratio));canvas.width=scratch.width=w;canvas.height=h;scratch.height=h*2;};
 function draw(){
  if(!overlay.isConnected||activeCardVideo!==video)return;
  videoFrameId=requestAnimationFrame(draw);
  if(video.readyState<2||video.currentTime===last||!canvas.width)return;last=video.currentTime;
  const w=canvas.width,h=canvas.height;sg.drawImage(video,0,0,w,h*2);const all=sg.getImageData(0,0,w,h*2),out=g.createImageData(w,h),length=w*h*4;
  for(let i=0;i<length;i+=4){out.data[i]=all.data[i];out.data[i+1]=all.data[i+1];out.data[i+2]=all.data[i+2];const a=all.data[length+i];out.data[i+3]=a<5?0:a>250?255:a;}
  g.putImageData(out,0,0);
 }
 wrap.append(canvas,video,toggle);overlay.append(closeBtn,wrap);document.body.append(overlay);
 if(cardData.efecto&&cardData.efecto!=='ninguno'){const particles=document.createElement('canvas');particles.className='msncard-particles';overlay.insertBefore(particles,wrap);startParticles(particles,cardData.efecto);}
 draw();video.play().catch(()=>{toggle.textContent='Reproducir';});
}
