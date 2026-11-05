// Medios WebRTC separados de la señalización para poder probar su ciclo de vida.
export class CallMedia {
  constructor({ getMedia, createPeer, createStream = () => new MediaStream(), onLocal = () => {}, onRemote = () => {}, onCandidate = () => {}, onState = () => {}, onFailure = () => {} }) {
    Object.assign(this, { getMedia, createPeer, createStream, onLocal, onRemote, onCandidate, onState, onFailure });
    this.closed = false;
    this.remoteReady = false;
    this.candidates = [];
    this.seenCandidates = new Set();
  }
  check() { if (this.closed) throw new Error('Llamada cancelada'); }
  async prepare() {
    if (this.preparing) return this.preparing;
    this.check();
    this.preparing = (async () => {
      const stream = await this.getMedia();
      if (this.closed) { stream.getTracks().forEach((track) => track.stop()); this.check(); }
      this.stream = stream;
      this.onLocal(stream);
      this.peer = this.createPeer();
      for (const track of stream.getTracks()) this.peer.addTrack(track, stream);
      this.peer.onicecandidate = ({ candidate }) => {
        if (!candidate || this.closed) return;
        try { Promise.resolve(this.onCandidate(candidate.toJSON ? candidate.toJSON() : candidate)).catch((error) => { if (!this.closed) this.onFailure(error); }); }
        catch (error) { this.onFailure(error); }
      };
      this.peer.ontrack = (event) => {
        if (this.closed) return;
        if (event.streams?.[0]) this.remoteStream = event.streams[0];
        else {
          this.remoteStream ||= this.createStream();
          if (!this.remoteStream.getTracks().includes(event.track)) this.remoteStream.addTrack(event.track);
        }
        this.onRemote(this.remoteStream);
      };
      this.peer.onconnectionstatechange = () => {
        if (this.closed) return;
        clearTimeout(this.disconnectTimer);
        const state = this.peer.connectionState;
        if (state === 'connected') this.onState('connected');
        if (state === 'failed') this.onFailure(new Error('No se pudo conectar la llamada'));
        if (state === 'disconnected') {
          this.onState('reconnecting');
          this.disconnectTimer = setTimeout(() => { if (!this.closed) this.onFailure(new Error('Se perdió la conexión')); }, 15_000);
        }
      };
    })();
    return this.preparing;
  }
  async offer() {
    await this.prepare(); this.check();
    const offer = await this.peer.createOffer(); this.check();
    await this.peer.setLocalDescription(offer); this.check();
    return this.peer.localDescription.sdp;
  }
  async answer(sdp) {
    await this.prepare(); this.check();
    await this.peer.setRemoteDescription({ type: 'offer', sdp }); this.check();
    this.remoteReady = true;
    await this.flush(); this.check();
    const answer = await this.peer.createAnswer(); this.check();
    await this.peer.setLocalDescription(answer); this.check();
    return this.peer.localDescription.sdp;
  }
  async applyAnswer(sdp) {
    if (this.answering) return this.answering;
    this.answering = (async () => {
      this.check();
      await this.peer.setRemoteDescription({ type: 'answer', sdp }); this.check();
      this.remoteReady = true;
      await this.flush();
    })();
    return this.answering;
  }
  async addCandidate(candidate) {
    if (this.closed) return;
    const key = JSON.stringify([candidate.candidate, candidate.sdpMid, candidate.sdpMLineIndex]);
    if (this.seenCandidates.has(key)) return;
    this.seenCandidates.add(key);
    this.candidates.push(candidate);
    await this.flush();
  }
  async flush() {
    if (!this.remoteReady || this.flushing || this.closed) return;
    this.flushing = true;
    try {
      while (this.candidates.length && !this.closed) await this.peer.addIceCandidate(this.candidates.shift());
    } finally { this.flushing = false; }
  }
  setEnabled(kind, enabled) {
    this.stream?.getTracks().filter((track) => track.kind === kind).forEach((track) => { track.enabled = enabled; });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.disconnectTimer);
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.peer) {
      this.peer.onicecandidate = this.peer.ontrack = this.peer.onconnectionstatechange = null;
      this.peer.close();
    }
    this.candidates.length = 0;
  }
}
