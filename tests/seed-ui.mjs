import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Solo se permite ejecutar contra emuladores.');
initializeApp({ projectId: 'familia-a9fb6' });
const db = getFirestore();
for (const [uid, name, avatar] of [['papa', 'Papá', '👨'], ['hija', 'Hija', '👧'], ['amor', 'Amor', '❤️']]) {
  try { await getAuth().createUser({ uid, email: `${uid}@chat-familia.local`, password: 'demo-local-123' }); }
  catch (error) { if (error.code !== 'auth/uid-already-exists') throw error; }
  await db.doc(`status/${uid}`).set({ email: `${uid}@chat-familia.local`, name, avatar, online: true, typing: false, activeChat: uid === 'amor' ? 'papa_amor' : 'papa_hija', lastSeen: Timestamp.now() });
}
const batch = db.batch();
const now = Date.now();
for (const [index, senderUid, text] of [[0, 'hija', '¡Hola, papá! ¿Cómo va tu día? 😊'], [1, 'papa', 'Muy bien 💚 ¿Jugamos una partida después?'], [2, 'hija', '¡Sí! Te mando una foto cuando llegue ✨']]) {
  batch.set(db.doc(`messages/demo-hija-${index}`), { chatId: 'papa_hija', senderUid, type: 'text', text, read: false, createdAt: Timestamp.fromMillis(now - 200000 + index * 1000) });
}
for (let i = 0; i < 120; i++) batch.set(db.doc(`messages/demo-amor-${i}`), { chatId: 'papa_amor', senderUid: 'amor', type: 'text', text: `Mensaje de prueba ${i + 1}`, read: false, createdAt: Timestamp.fromMillis(now - 150000 + i * 1000) });
await batch.commit();
console.log('Cuentas y conversaciones de prueba listas en emuladores locales. Clave: demo-local-123');
