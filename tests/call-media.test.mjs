import test from 'node:test';
import assert from 'node:assert/strict';
import { CallMedia } from '../js/call-media.js';

function fixture(mediaFactory) {
  const tracks = ['audio', 'video'].map((kind) => ({kind, enabled:true, stopped:0, stop(){this.stopped++;}}));
  const stream = {getTracks:()=>tracks};
  const peer = {
    candidates:[], tracks:[], remoteSets:0, closed:0,
    addTrack(track){this.tracks.push(track);},
    async createOffer(){return {type:'offer',sdp:'local-offer'};},
    async createAnswer(){return {type:'answer',sdp:'local-answer'};},
    async setLocalDescription(value){this.localDescription=value;},
    async setRemoteDescription(value){this.remoteSets++;this.remoteDescription=value;},
    async addIceCandidate(value){assert.ok(this.remoteDescription);this.candidates.push(value);},
    close(){this.closed++;}
  };
  const states=[], local=[], remote=[];
  const media = new CallMedia({getMedia:mediaFactory || (async()=>stream),createPeer:()=>peer,
    onLocal:(value)=>local.push(value),onRemote:(value)=>remote.push(value),onState:(value)=>states.push(value)});
  return {media,peer,stream,tracks,states,local,remote};
}
test('no pide medios hasta iniciar y solo prepara un micrófono/cámara por sesión', async()=>{
  const f=fixture(); assert.equal(f.local.length,0);
  await Promise.all([f.media.prepare(),f.media.prepare()]);
  assert.equal(f.local.length,1);assert.equal(f.peer.tracks.length,2);
  assert.equal(await f.media.offer(),'local-offer');
  assert.equal(f.local.length,1); f.media.close();
});
test('espera al SDP remoto antes de aplicar candidatos y descarta duplicados',async()=>{
  const f=fixture();
  const c={candidate:'candidate-1',sdpMid:'0',sdpMLineIndex:0};
  await f.media.addCandidate(c); await f.media.addCandidate({...c});
  assert.equal(f.peer.candidates.length,0);
  await f.media.offer();
  await Promise.all([f.media.applyAnswer('answer'),f.media.applyAnswer('answer')]);
  assert.equal(f.peer.remoteSets,1);assert.equal(f.peer.candidates.length,1);
  f.media.close();
});
test('responder aplica oferta, candidatos y respuesta en orden',async()=>{
  const f=fixture();
  await f.media.addCandidate({candidate:'early'});
  assert.equal(await f.media.answer('offer'),'local-answer');
  assert.equal(f.peer.remoteDescription.type,'offer');assert.equal(f.peer.candidates.length,1);
  f.media.close();
});
test('colgar mientras el permiso está pendiente detiene todos los medios que lleguen después',async()=>{
  let release;
  const f=fixture(()=>new Promise((resolve)=>{release=resolve;}));
  const pending=f.media.offer();
  f.media.close();release(f.stream);
  await assert.rejects(pending,/cancelada/);
  assert.deepEqual(f.tracks.map((track)=>track.stopped),[1,1]);assert.equal(f.peer.tracks.length,0);
});
test('silenciar, apagar cámara y colgar liberan las dos pistas sin reabrirlas',async()=>{
  const f=fixture();await f.media.prepare();
  f.media.setEnabled('audio',false);assert.equal(f.tracks[0].enabled,false);assert.equal(f.tracks[1].enabled,true);
  f.media.setEnabled('video',false);assert.equal(f.tracks[1].enabled,false);
  f.media.setEnabled('audio',true);assert.equal(f.tracks[0].enabled,true);
  f.media.close();f.media.close();
  assert.deepEqual(f.tracks.map((track)=>track.stopped),[1,1]);assert.equal(f.peer.closed,1);
  await f.media.addCandidate({candidate:'late'});assert.equal(f.peer.candidates.length,0);
});


test('cambiar cámara reemplaza solo vídeo y conserva micrófono y silencio', async () => {
  const f = fixture(); await f.media.prepare();
  f.media.setEnabled('video', false);
  const next = {kind:'video',enabled:true,stop(){this.stopped=true;}};
  let sent, constraints;
  f.peer.getSenders = () => [{track:f.tracks[1],async replaceTrack(track){sent=track;}}];
  f.stream.removeTrack = (track) => f.tracks.splice(f.tracks.indexOf(track),1);
  f.stream.addTrack = (track) => f.tracks.push(track);
  f.media.getMedia = async (value) => { constraints=value; return {getTracks:()=>[next]}; };
  await f.media.switchCamera('environment');
  assert.equal(constraints.audio,false);
  assert.equal(constraints.video.facingMode.exact,'environment');
  assert.equal(sent,next); assert.equal(next.enabled,false);
  assert.equal(f.tracks[0].stopped,0); assert.equal(f.tracks[1],next);
  f.media.close(); assert.equal(next.stopped,true);
});

test('colgar durante cambio de cámara libera la nueva pista', async () => {
  const f=fixture();await f.media.prepare();
  let release;
  const next={kind:'video',stop(){this.stopped=true;}};
  f.peer.getSenders=()=>[{track:f.tracks[1],async replaceTrack(){assert.fail('llamada cerrada');}}];
  f.media.getMedia=()=>new Promise(resolve=>{release=resolve;});
  const changing=f.media.switchCamera('environment');
  f.media.close();release({getTracks:()=>[next]});
  await assert.rejects(changing,/cancelada/);assert.equal(next.stopped,true);
});
