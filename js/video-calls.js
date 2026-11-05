import { doc, collection, query, where, onSnapshot, runTransaction, serverTimestamp, addDoc, getDocs, writeBatch } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { CallMedia } from './call-media.js';

const time = (value) => value?.toMillis?.() || 0;
const uuid = () => crypto.randomUUID();
const terminal = (data) => !data || data.status === 'ended' || Date.now() - time(data.updatedAt) > 90_000;

export function initVideoCalls(ctx) {
  const dock = document.createElement('section');
  dock.className = 'call-dock hidden';
  dock.setAttribute('aria-label', 'Videollamada en curso');
  dock.innerHTML = `<div class="call-grip"><span class="call-person"></span><button type="button" class="call-fold" aria-label="Minimizar videollamada" aria-expanded="true">−</button><button type="button" class="call-end" aria-label="Colgar">☎</button></div>
    <div class="call-videos"><video class="call-remote" autoplay playsinline></video><video class="call-local" autoplay playsinline muted></video></div>
    <div class="call-state" role="status" aria-live="polite"></div>
    <div class="call-controls"><button type="button" class="call-mic" aria-pressed="false" aria-label="Silenciar micrófono">🎙️</button><button type="button" class="call-camera" aria-pressed="false" aria-label="Apagar cámara">📹</button><button type="button" class="call-sound hidden">Activar sonido</button></div>`;
  const invite = document.createElement('section');
  invite.className = 'call-invite hidden';
  invite.setAttribute('role', 'alertdialog');
  invite.setAttribute('aria-labelledby', 'video-invite-title');
  invite.innerHTML = `<span aria-hidden="true">📹</span><h3 id="video-invite-title"></h3><p>¿Quieres conversar con cámara y micrófono?</p><div><button type="button" class="call-decline">Rechazar</button><button type="button" class="call-accept">Aceptar</button></div>`;
  document.body.append(dock, invite);
  const $ = (selector) => dock.querySelector(selector);
  const remote = $('.call-remote'), local = $('.call-local');
  local.muted = true;
  let route = null, epoch = 0, unsubscribe = null, incoming = null, session = null, signalError = null;
  let incomingTimer;
  const stateLabels = { permission: 'Preparando cámara…', ringing: 'Llamando…', connecting: 'Conectando…', connected: 'En llamada', reconnecting: 'Reconectando…' };
  function showState(state) { $('.call-state').textContent = stateLabels[state] || state; }
  function hideInvite() { incoming = null; clearTimeout(incomingTimer); invite.classList.add('hidden'); }
  async function mutate(s, patch, allowed = () => true) {
    return runTransaction(ctx.db, async (tx) => {
      const snapshot = await tx.get(s.ref);
      const data = snapshot.data();
      if (!data || data.callId !== s.id || data.status === 'ended' || !allowed(data)) return false;
      tx.update(s.ref, { ...patch, updatedAt: serverTimestamp() });
      return true;
    });
  }
  async function deleteCandidates(s) {
    try {
      const snapshot = await getDocs(query(collection(s.ref, 'candidates'), where('callId', '==', s.id)));
      for (let offset = 0; offset < snapshot.size; offset += 400) {
        const batch = writeBatch(ctx.db);
        snapshot.docs.slice(offset, offset + 400).forEach((candidate) => batch.delete(candidate.ref));
        await batch.commit();
      }
    } catch (error) { console.debug('Limpieza de señalización pendiente', error.code); }
  }
  function close(s, notifyPeer = true, message = '') {
    if (!s || s.closed) return;
    s.closed = true;
    s.media?.close();
    s.unsubscribe?.();
    clearInterval(s.heartbeat);
    clearTimeout(s.deadline);
    if (session === s) {
      session = null;
      local.srcObject = remote.srcObject = null;
      dock.classList.add('hidden');
      if (message) ctx.toast(message);
    }
    if (notifyPeer && (s.published || s.signalExists)) mutate(s, { status: 'ended' }, (data) =>
      s.role === 'caller' ? data.callerDeviceId === s.deviceId : !data.answererId || data.answererId === s.deviceId
    ).then(() => deleteCandidates(s)).catch(console.warn);
    else if (s.published) deleteCandidates(s);
  }
  function failure(s, error) {
    if (s.closed) return;
    console.error('Videollamada', error);
    const message = error.name === 'NotAllowedError' ? 'Necesitamos permiso de cámara y micrófono para la llamada.'
      : error.name === 'NotFoundError' ? 'No encontramos una cámara o micrófono disponibles.'
      : error.code === 'permission-denied' ? 'La videollamada necesita que se actualice la configuración del chat.'
      : 'No pudimos conectar la videollamada. Inténtalo otra vez o prueba con otra red.';
    close(s, true, message);
  }
  async function iceConfig() {
    let servers = ctx.config?.iceServers || [];
    if (ctx.config?.credentialsEndpoint) {
      const endpoint = new URL(ctx.config.credentialsEndpoint, location.href);
      if (endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(endpoint.hostname)) throw new Error('Endpoint de medios no seguro');
      const token = await ctx.getToken();
      const response = await fetch(endpoint.href, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('No se pudo preparar la conexión');
      servers = (await response.json()).iceServers;
    }
    if (!Array.isArray(servers)) throw new Error('Configuración de conexión inválida');
    return { iceServers: servers, iceCandidatePoolSize: 2 };
  }
  async function sendCandidate(s, candidate) {
    if (session !== s || s.closed) return;
    if (!s.published) { s.pending.push(candidate); return; }
    await addDoc(collection(s.ref, 'candidates'), {
      callId: s.id, fromUid: s.route.uid, candidate: candidate.candidate,
      sdpMid: candidate.sdpMid ?? null, sdpMLineIndex: candidate.sdpMLineIndex ?? null,
      createdAt: serverTimestamp()
    });
  }
  function watchCandidates(s) {
    s.unsubscribe = onSnapshot(query(collection(s.ref, 'candidates'), where('callId', '==', s.id)), (snapshot) => {
      if (session !== s || s.closed) return;
      for (const change of snapshot.docChanges()) {
        const value = change.doc.data();
        if (change.type === 'added' && value.fromUid !== s.route.uid) {
          s.media.addCandidate({ candidate: value.candidate, sdpMid: value.sdpMid, sdpMLineIndex: value.sdpMLineIndex }).catch((error) => failure(s, error));
        }
      }
    }, (error) => failure(s, error));
    s.heartbeat = setInterval(() => {
      if (session === s && !s.closed) mutate(s, {}).catch((error) => failure(s, error));
    }, 10_000);
    for (const candidate of s.pending.splice(0)) sendCandidate(s, candidate).catch((error) => failure(s, error));
  }
  async function makeSession(id, role, target) {
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error('Este dispositivo no permite videollamadas');
    ctx.beforeStart();
    const s = { id, role, route: { ...target }, ref: doc(ctx.db, 'calls', target.chatId), deviceId: uuid(), pending: [], closed: false, published: false, signalExists: role === 'callee' };
    session = s;
    dock.classList.remove('hidden', 'folded');
    $('.call-fold').setAttribute('aria-expanded', 'true');
    $('.call-person').textContent = target.partnerName;
    $('.call-mic').setAttribute('aria-pressed', 'false');
    $('.call-mic').setAttribute('aria-label', 'Silenciar micrófono');
    $('.call-camera').setAttribute('aria-pressed', 'false');
    $('.call-camera').setAttribute('aria-label', 'Apagar cámara');
    $('.call-mic').textContent = '🎙️';
    $('.call-camera').textContent = '📹';
    $('.call-mic').disabled = $('.call-camera').disabled = true;
    $('.call-sound').classList.add('hidden');
    showState('permission');
    try {
      const config = await iceConfig();
      if (session !== s || s.closed) throw new Error('Llamada cancelada');
      s.media = new CallMedia({
        getMedia: () => navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 320, max: 640 }, height: { ideal: 240, max: 480 }, frameRate: { ideal: 15, max: 20 } },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        }),
        createPeer: () => new RTCPeerConnection(config),
        onLocal: (stream) => { if (session === s) {
          local.srcObject = stream; local.play().catch(() => {});
          $('.call-mic').disabled = $('.call-camera').disabled = false;
        } },
        onRemote: (stream) => {
          if (session !== s || s.closed) return;
          if (remote.srcObject !== stream) remote.srcObject = stream;
          remote.play().catch(() => { if (session === s) $('.call-sound').classList.remove('hidden'); });
        },
        onCandidate: (candidate) => sendCandidate(s, candidate),
        onState: (state) => {
          if (session !== s || s.closed) return;
          showState(state);
          if (state === 'connected') {
            s.connected = true;
            clearTimeout(s.deadline);
            mutate(s, { status: 'active' }, (data) => ['connecting', 'active'].includes(data.status)).catch((error) => failure(s, error));
          }
        },
        onFailure: (error) => failure(s, error)
      });
      return s;
    } catch (error) { failure(s, error); throw error; }
  }
  async function start() {
    if (session) { dock.classList.remove('folded'); $('.call-fold').setAttribute('aria-expanded', 'true'); return; }
    if (incoming) { invite.querySelector('.call-accept').focus(); return; }
    if (!route) return;
    if (signalError) { ctx.toast('La videollamada necesita que se actualice la configuración del chat.'); return; }
    const target = { ...route };
    let s;
    try {
      s = await makeSession(uuid(), 'caller', target);
      const offer = await s.media.offer();
      if (session !== s || s.closed) return;
      await runTransaction(ctx.db, async (tx) => {
        const snapshot = await tx.get(s.ref);
        if (!terminal(snapshot.data())) throw new Error('Ya hay una llamada en este chat');
        if (s.closed || session !== s) throw new Error('Llamada cancelada');
        tx.set(s.ref, { callId: s.id, callerUid: target.uid, callerEmail: target.email,
          callerDeviceId: s.deviceId, targetEmail: target.partnerEmail, calleeUid: null,
          answererId: null, offer, answer: null, status: 'ringing', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      });
      s.published = true;
      if (session !== s || s.closed) { mutate(s, {status:'ended'}).catch(console.warn); return; }
      showState(s.connected ? 'connected' : s.answerApplied ? 'connecting' : 'ringing');
      watchCandidates(s);
      if (!s.connected && !s.answerApplied) s.deadline = setTimeout(() => close(s, true, 'No hubo respuesta a la llamada.'), 45_000);
    } catch (error) {
      if (s && !s.closed && error.message === 'Ya hay una llamada en este chat') close(s, false, error.message);
      else if (s) failure(s, error);
      else ctx.toast(error.message || 'No se pudo iniciar la videollamada.');
    }
  }
  async function accept() {
    if (!incoming || session || !route) return;
    const data = incoming, target = { ...route };
    hideInvite();
    let s;
    try {
      s = await makeSession(data.callId, 'callee', target);
      const answer = await s.media.answer(data.offer);
      if (session !== s || s.closed) return;
      const accepted = await mutate(s, { answer, calleeUid: target.uid, answererId: s.deviceId, status: 'connecting' }, (current) => current.status === 'ringing');
      if (!accepted) { close(s, false, 'La llamada ya terminó o fue atendida en otro dispositivo.'); return; }
      s.published = true;
      if (s.closed || session !== s) { mutate(s, {status:'ended'}).catch(console.warn); return; }
      showState(s.connected ? 'connected' : 'connecting');
      watchCandidates(s);
      if (!s.connected) s.deadline = setTimeout(() => failure(s, new Error('Tiempo de conexión agotado')), 40_000);
    } catch (error) { if (s) failure(s, error); else ctx.toast(error.message); }
  }
  async function decline() {
    if (!incoming || !route) return;
    const data = incoming;
    const s = { id: data.callId, ref: doc(ctx.db, 'calls', route.chatId) };
    hideInvite();
    try { await mutate(s, { status: 'ended' }, (current) => current.status === 'ringing'); await deleteCandidates(s); } catch (error) { console.warn(error); }
  }
  function receive(data) {
    if (!data || data.status === 'ended') {
      hideInvite();
      if (session && ((!data && session.published) || data?.callId === session.id)) close(session, false, 'Llamada finalizada.');
      return;
    }
    if (session && data.callId === session.id) {
      const s = session;
      if (s.role === 'callee' && data.answererId && data.answererId !== s.deviceId) { close(s, false); return; }
      if (s.role === 'caller' && data.answer && !s.answerApplied) {
        s.answerApplied = true;
        clearTimeout(s.deadline);
        showState('connecting');
        s.deadline = setTimeout(() => failure(s, new Error('Tiempo de conexión agotado')), 40_000);
        s.media.applyAnswer(data.answer).catch((error) => failure(s, error));
      }
      return;
    }
    if (session) {
      // No cerrar una sesión local cuyo documento todavía se está publicando.
      if (!session.published) return;
      close(session, false);
    }
    if (data.status !== 'ringing' || data.targetEmail !== route.email || data.callerUid === route.uid || Date.now() - time(data.createdAt) > 45_000) {
      hideInvite(); return;
    }
    const isNew = incoming?.callId !== data.callId;
    incoming = data;
    invite.querySelector('h3').textContent = `${route.partnerName} te está llamando`;
    invite.classList.remove('hidden');
    if (isNew) {
      clearTimeout(incomingTimer);
      incomingTimer = setTimeout(hideInvite, Math.max(1000, 46_000 - (Date.now() - time(data.createdAt))));
      ctx.notify?.(`Videollamada de ${route.partnerName}`, 'Abre el chat para responder.', 'video-call')?.catch(console.warn);
    }
  }
  function setChat(next) {
    if (route && next && route.chatId === next.chatId && route.uid === next.uid) {
      route = { ...next }; if (session) $('.call-person').textContent = next.partnerName; return;
    }
    epoch++;
    unsubscribe?.(); unsubscribe = null;
    hideInvite();
    if (session) close(session, true);
    route = next ? { ...next } : null;
    signalError = null;
    if (!route) return;
    const version = epoch;
    unsubscribe = onSnapshot(doc(ctx.db, 'calls', route.chatId), (snapshot) => {
      if (version === epoch && route) receive(snapshot.data());
    }, (error) => { if (version === epoch) { signalError = error; console.warn('Señalización de llamadas', error.code); } });
  }
  $('.call-end').addEventListener('click', () => close(session, true));
  $('.call-fold').addEventListener('click', () => {
    const folded = dock.classList.toggle('folded');
    $('.call-fold').setAttribute('aria-expanded', String(!folded));
    $('.call-fold').setAttribute('aria-label', folded ? 'Mostrar videollamada' : 'Minimizar videollamada');
  });
  for (const [selector, kind, onLabel, offLabel] of [
    ['.call-mic', 'audio', 'Silenciar micrófono', 'Activar micrófono'],
    ['.call-camera', 'video', 'Apagar cámara', 'Activar cámara']
  ]) $(selector).addEventListener('click', () => {
    if (!session?.media?.stream) return;
    const muted = $(selector).getAttribute('aria-pressed') !== 'true';
    session.media.setEnabled(kind, !muted);
    $(selector).setAttribute('aria-pressed', String(muted));
    $(selector).setAttribute('aria-label', muted ? offLabel : onLabel);
    $(selector).textContent = kind === 'audio' ? (muted ? '🔇' : '🎙️') : (muted ? '🚫' : '📹');
  });
  $('.call-sound').addEventListener('click', () => remote.play().then(() => $('.call-sound').classList.add('hidden')).catch(() => ctx.toast('No se pudo reproducir el sonido.')));
  invite.querySelector('.call-accept').addEventListener('click', accept);
  invite.querySelector('.call-decline').addEventListener('click', decline);
  // Arrastrar solo desde la cabecera; los controles y el vídeo siguen recibiendo toques.
  let drag = null;
  const grip = $('.call-grip');
  grip.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    const rect = dock.getBoundingClientRect();
    drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    grip.setPointerCapture(event.pointerId);
  });
  grip.addEventListener('pointermove', (event) => {
    if (!drag) return;
    dock.style.left = `${Math.max(4, Math.min(innerWidth - dock.offsetWidth - 4, event.clientX - drag.x))}px`;
    dock.style.top = `${Math.max(4, Math.min(innerHeight - dock.offsetHeight - 4, event.clientY - drag.y))}px`;
    dock.style.right = 'auto';
  });
  const stopDrag = () => { drag = null; };
  grip.addEventListener('pointerup', stopDrag); grip.addEventListener('pointercancel', stopDrag);
  window.addEventListener('pagehide', () => { hideInvite(); close(session, true); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible' && session) close(session, true); });
  return { start, setChat, get active() { return Boolean(session); },
    setGameMode: (active) => dock.classList.toggle('in-game', active) };
}
