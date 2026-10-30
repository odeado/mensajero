import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';

const projectId = process.env.GCLOUD_PROJECT;
if (!projectId) throw new Error('Define GCLOUD_PROJECT. Usa credenciales de administrador mediante GOOGLE_APPLICATION_CREDENTIALS.');
initializeApp({ projectId, ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }) });
const db = getFirestore();
const apply = process.argv.includes('--apply');
const gameChats = new Map();
const changes = [];
const allowed = new Set(['papa_hija', 'papa_amor']);
async function* documents(collection) {
  let cursor;
  while (true) {
    let query = db.collection(collection).orderBy(FieldPath.documentId()).limit(200);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    for (const doc of snapshot.docs) yield doc;
    if (snapshot.size < 200) break;
    cursor = snapshot.docs.at(-1);
  }
}
for await (const doc of documents('messages')) {
  const message = doc.data();
  const chatId = message.chatId || 'papa_hija';
  if (!allowed.has(chatId)) throw new Error(`Chat desconocido en ${doc.ref.path}; revisa antes de migrar.`);
  if (!message.chatId) changes.push({ ref: doc.ref, chatId });
  if (message.type === 'game' && message.gameId) {
    if (gameChats.has(message.gameId) && gameChats.get(message.gameId) !== chatId) throw new Error('Una partida está vinculada a dos conversaciones.');
    gameChats.set(message.gameId, chatId);
  }
}
let orphanGames = 0;
for await (const doc of documents('games')) {
  const game = doc.data();
  if (game.chatId) continue;
  const chatId = gameChats.get(doc.id);
  // Una partida sin invitación no permite inferir su conversación: queda inaccesible.
  if (!chatId) { orphanGames++; continue; }
  changes.push({ ref: doc.ref, chatId });
}
console.log(JSON.stringify({ projectId, mode: apply ? 'apply' : 'dry-run', documents: changes.length, orphanGames }, null, 2));
if (apply) {
  for (let offset = 0; offset < changes.length; offset += 400) {
    const batch = db.batch();
    for (const { ref, chatId } of changes.slice(offset, offset + 400)) batch.update(ref, { chatId });
    await batch.commit();
  }
  console.log('Migración terminada. No se borraron documentos.');
}
