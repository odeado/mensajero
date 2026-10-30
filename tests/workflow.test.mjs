import test from 'node:test';
import assert from 'node:assert/strict';
import { captureDestination, unreadInChat } from '../js/workflow.js';

test('el destino no cambia al cambiar de chat o de cuenta durante una preparación', async () => {
  let user = { uid: 'papa' }, chat = 'papa_hija';
  const target = captureDestination(user, chat);
  await Promise.resolve();
  user = { uid: 'otra-cuenta' }; chat = 'papa_amor';
  assert.deepEqual(target, { uid: 'papa', chatId: 'papa_hija' });
  assert.ok(Object.isFrozen(target));
  assert.throws(() => captureDestination(null, chat));
});
test('leer Hija no marca Amor ni mensajes propios ni los ya leídos', () => {
  const docs = [
    { chatId: 'papa_hija', senderUid: 'hija', read: false },
    { chatId: 'papa_amor', senderUid: 'amor', read: false },
    { chatId: 'papa_hija', senderUid: 'papa', read: false },
    { chatId: 'papa_hija', senderUid: 'hija', read: true }
  ].map((data, id) => ({ id, data: () => data }));
  assert.deepEqual(unreadInChat(docs, 'papa', 'papa_hija').map((d) => d.id), [0]);
});
