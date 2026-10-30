import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

test('la migración no escribe en dry-run, conserva datos y puede repetirse', async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Requiere el emulador');
  const app = initializeApp({ projectId: 'demo-mensajero' });
  const db = getFirestore(app);
  try {
    await db.doc('messages/legacy').set({ senderUid: 'papa', text: 'Mensaje histórico', type: 'text' });
    await db.doc('messages/invite').set({ type: 'game', gameId: 'legacy-game', chatId: 'papa_amor' });
    await db.doc('games/legacy-game').set({ type: 'gato', players: ['papa', null] });
    await db.doc('games/orphan').set({ type: 'gato', players: ['papa', null] });
    const migrate = (...args) => execFileSync(process.execPath, ['scripts/migrate-chats.mjs', ...args], { env: { ...process.env, GCLOUD_PROJECT: 'demo-mensajero' }, encoding: 'utf8' });
    migrate();
    assert.equal((await db.doc('messages/legacy').get()).data().chatId, undefined);
    migrate('--apply');
    assert.equal((await db.doc('messages/legacy').get()).data().chatId, 'papa_hija');
    assert.equal((await db.doc('messages/legacy').get()).data().text, 'Mensaje histórico');
    assert.equal((await db.doc('games/legacy-game').get()).data().chatId, 'papa_amor');
    assert.equal((await db.doc('games/orphan').get()).data().chatId, undefined);
    assert.match(migrate('--apply'), /"documents": 0/);
  } finally { await deleteApp(app); }
});
