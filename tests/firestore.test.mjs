import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, where, orderBy, limit, setDoc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
let env;
const database = (uid) => env.authenticatedContext(uid, { email: `${uid}@chat-familia.local` }).firestore();
const message = (chatId, senderUid) => ({ chatId, senderUid, type: 'text', text: 'Hola', read: false, createdAt: serverTimestamp() });
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-mensajero', firestore: { rules: await readFile('firestore.rules', 'utf8') } });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'messages', 'hija'), message('papa_hija', 'hija'));
    await setDoc(doc(db, 'messages', 'amor'), message('papa_amor', 'amor'));
  });
});
test('cada cuenta solo puede leer sus conversaciones, incluso por ID conocido', async () => {
  await assertSucceeds(getDoc(doc(database('hija'), 'messages', 'hija')));
  await assertFails(getDoc(doc(database('hija'), 'messages', 'amor')));
  await assertFails(getDoc(doc(database('amor'), 'messages', 'hija')));
  for (const chatId of ['papa_hija', 'papa_amor']) await assertSucceeds(getDocs(query(collection(database('papa'), 'messages'), where('chatId', '==', chatId), orderBy('createdAt'), limit(50))));
  await assertFails(getDocs(collection(database('hija'), 'messages')));
  await assertSucceeds(getDocs(query(collection(database('papa'), 'messages'), where('chatId', 'in', ['papa_hija', 'papa_amor']), where('createdAt', '>', new Date(0)), orderBy('createdAt'), limit(100))));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'messages', 'hija')));
});
test('se impiden envíos cruzados y suplantar al remitente', async () => {
  const db = database('hija');
  await assertSucceeds(setDoc(doc(db, 'messages', 'ok'), message('papa_hija', 'hija')));
  await assertFails(setDoc(doc(db, 'messages', 'cross'), message('papa_amor', 'hija')));
  await assertFails(setDoc(doc(db, 'messages', 'fake'), message('papa_hija', 'papa')));
});
test('leídos y reacciones no permiten modificar el contenido ni otro chat', async () => {
  await assertSucceeds(updateDoc(doc(database('papa'), 'messages', 'hija'), { read: true }));
  await assertFails(updateDoc(doc(database('hija'), 'messages', 'amor'), { read: true }));
  await assertFails(updateDoc(doc(database('papa'), 'messages', 'hija'), { text: 'Alterado' }));
  await assertSucceeds(updateDoc(doc(database('papa'), 'messages', 'hija'), { 'reactions.papa': '❤️' }));
  await assertFails(updateDoc(doc(database('papa'), 'messages', 'hija'), { 'reactions.hija': '❤️' }));
});
test('partidas: el tercer usuario no puede leer, unirse ni modificar', async () => {
  const ref = (uid) => doc(database(uid), 'games', 'partida');
  await assertSucceeds(setDoc(ref('papa'), { type: 'gato', chatId: 'papa_hija', players: ['papa', null] }));
  await assertFails(getDoc(ref('amor')));
  await assertFails(updateDoc(ref('amor'), { players: ['papa', 'amor'] }));
  await assertSucceeds(updateDoc(ref('hija'), { players: ['papa', 'hija'] }));
  await assertFails(updateDoc(ref('papa'), { players: ['papa', 'amor'] }));
  await assertFails(updateDoc(ref('papa'), { chatId: 'papa_amor' }));
  await assertSucceeds(updateDoc(ref('hija'), { moves: 1 }));
});

test('Pictionary: solo acepta agotar el tiempo cuando venció en el servidor', async () => {
  const seed = async (id, ago) => env.withSecurityRulesDisabled((context)=>setDoc(doc(context.firestore(),'games',id),{
    type:'pictionary',chatId:'papa_hija',players:['papa','hija'],phase:'drawing',drawer:0,word:'gato',
    round:1,score:[0,0],winner:null,strokes:[],guesses:[],moves:0,
    roundStartedAt:Timestamp.fromMillis(Date.now()-ago),roundEndedAt:null,roundOutcome:null
  }));
  const end={phase:'roundEnd',roundOutcome:'timeout',roundEndedAt:serverTimestamp(),updatedAt:serverTimestamp()};
  await seed('too-early',5000);
  await assertFails(updateDoc(doc(database('papa'),'games','too-early'),end));
  await seed('expired',61_000);
  await assertSucceeds(updateDoc(doc(database('hija'),'games','expired'),end));
  await assertFails(updateDoc(doc(database('hija'),'games','expired'),{phase:'drawing',round:2,drawer:1,word:'sol',roundStartedAt:serverTimestamp(),roundEndedAt:null,roundOutcome:null,updatedAt:serverTimestamp()}));
  await seed('late-guess',61_000);
  await assertFails(updateDoc(doc(database('hija'),'games','late-guess'),{...end,roundOutcome:'guessed',score:[0,1]}));
});

const offer = (extra={})=>({callId:'session-one',callerUid:'papa',callerEmail:'papa@chat-familia.local',callerDeviceId:'device-papa',targetEmail:'hija@chat-familia.local',calleeUid:null,answererId:null,offer:'sdp-offer',answer:null,status:'ringing',createdAt:serverTimestamp(),updatedAt:serverTimestamp(),...extra});
test('videollamadas: separa chats e impide suplantar al llamante o al destinatario',async()=>{
  const ref=(uid,chat='papa_hija')=>doc(database(uid),'calls',chat);
  await assertSucceeds(setDoc(ref('papa'),offer()));
  await assertFails(getDoc(ref('amor')));
  await assertFails(setDoc(ref('amor','papa_amor'),offer()));
  await assertFails(setDoc(ref('hija','papa_amor'),offer({callerUid:'hija',callerEmail:'hija@chat-familia.local'})));
  await assertFails(updateDoc(ref('papa'),{calleeUid:'papa',answererId:'device',answer:'answer',status:'connecting',updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(ref('hija'),{calleeUid:'hija',answererId:'device-hija',answer:'answer',status:'connecting',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref('hija'),{offer:'alterado',updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref('amor'),{status:'ended',updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(ref('papa'),{status:'active',updatedAt:serverTimestamp()}));
  await assertFails(setDoc(ref('papa'),offer({callId:'otro-intento'})));
  await assertSucceeds(updateDoc(ref('hija'),{status:'ended',updatedAt:serverTimestamp()}));
  await assertSucceeds(setDoc(ref('papa'),offer({callId:'otra-llamada'})));
});
test('candidatos de vídeo: solo la sesión y remitente correctos pueden escribir',async()=>{
  await setDoc(doc(database('papa'),'calls','papa_hija'),offer());
  const candidate={callId:'session-one',fromUid:'papa',candidate:'candidate:test',sdpMid:'0',sdpMLineIndex:0,createdAt:serverTimestamp()};
  const ref=(uid,id)=>doc(database(uid),'calls','papa_hija','candidates',id);
  await assertSucceeds(setDoc(ref('papa','ok'),candidate));
  await assertFails(setDoc(ref('papa','old'),{...candidate,callId:'old-session'}));
  await assertFails(setDoc(ref('hija','not-accepted'),{...candidate,fromUid:'hija'}));
  await assertFails(getDoc(ref('amor','ok')));
  await assertSucceeds(getDocs(query(collection(database('hija'),'calls','papa_hija','candidates'),where('callId','==','session-one'))));
});
