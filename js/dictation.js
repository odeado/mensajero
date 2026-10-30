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
      rec.interimResults = true;
      rec.continuous = true;
      rec.onstart = () => { if (session === rec) onState('listening'); };
      rec.onresult = (event) => {
        if (session !== rec) return;
        // results contiene la sesión completa; reconstruir evita duplicar frases
        // cuando un resultado provisional se convierte en definitivo.
        const spoken = Array.from(event.results, (result) => result[0].transcript.trim()).filter(Boolean).join(' ');
        setText([base, spoken].filter(Boolean).join(' ').slice(0, maxLength));
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
