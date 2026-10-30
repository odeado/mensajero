// Una sesión aislada: los resultados tardíos no pueden cambiar otro borrador.
export function createDictation({ createRecognition, getText, setText, onState, onError, maxLength = 4000 }) {
  let session = null;
  function finish(rec) {
    if (session !== rec) return;
    session = null;
    onState('idle');
  }
  return {
    get active() { return session !== null; },
    start() {
      if (session) return;
      let rec;
      try { rec = createRecognition(); }
      catch { onError('unavailable'); return; }
      if (!rec) { onError('unsupported'); return; }
      const base = getText().trimEnd();
      session = rec;
      rec.lang = 'es-CL';
      // Una frase por activación. Algunos motores móviles repiten hipótesis
      // acumuladas en modo continuo; no convertirlas en nuevos fragmentos.
      rec.interimResults = false;
      rec.continuous = false;
      rec.onstart = () => { if (session === rec) onState('listening'); };
      rec.onresult = (event) => {
        if (session !== rec) return;
        const finalResult = Array.from(event.results).filter((result) => result.isFinal).at(-1);
        if (!finalResult) return;
        const spoken = finalResult[0].transcript.trim();
        if (!spoken) return;
        // Conservar el texto literal de la frase, incluso si se dijo «no no».
        // Cerrar la sesión antes de escribir bloquea cualquier repetición tardía.
        finish(rec);
        setText([base, spoken].filter(Boolean).join(' ').slice(0, maxLength));
        try { rec.abort(); } catch {}
      };
      rec.onerror = (event) => {
        if (session !== rec) return;
        finish(rec);
        try { rec.abort(); } catch {}
        if (event.error !== 'aborted') onError(event.error);
      };
      rec.onend = () => finish(rec);
      onState('starting');
      try { rec.start(); }
      catch { finish(rec); onError('unavailable'); }
    },
    stop() {
      const rec = session;
      if (!rec) return;
      finish(rec);
      // Conservar lo que ya se ve en el campo e ignorar callbacks posteriores.
      try { rec.abort(); } catch {}
    }
  };
}
