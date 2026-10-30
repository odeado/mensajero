import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, where, orderBy, limit, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
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
