import test from 'node:test';
import assert from 'node:assert/strict';
import { createDictation } from '../js/dictation.js';

function setup(initial = '', maxLength = 4000) {
  let text = initial;
  const recognizers = [], states = [], errors = [];
  const controller = createDictation({
    createRecognition() {
      const rec = { starts: 0, aborts: 0, start() { this.starts++; }, abort() { this.aborts++; } };
      recognizers.push(rec);
      return rec;
    },
    getText: () => text,
    setText: (value) => { text = value; },
    onState: (state) => states.push(state),
    onError: (error) => errors.push(error),
    maxLength
  });
  return { controller, recognizers, states, errors, text: () => text };
}
const results = (...parts) => ({ results: parts.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })) });

test('mantiene una sesión al iniciar y escribe español en el borrador', () => {
  const s = setup('Hola');
  s.controller.start();
  s.controller.start(); // Incluso antes de recibir onstart, no abre dos micrófonos.
  assert.equal(s.recognizers.length, 1);
  const rec = s.recognizers[0];
  assert.equal(rec.lang, 'es-CL');
  rec.onstart();
  assert.equal(s.controller.active, true);
  rec.onresult(results(['cómo estás', true]));
  assert.equal(s.text(), 'Hola cómo estás');
  assert.deepEqual(s.states, ['starting', 'listening', 'idle']);
  assert.equal(rec.continuous, false);
  assert.equal(rec.interimResults, false);
});
test('no inserta provisionales y confirma una frase una sola vez', () => {
  const s = setup('Mensaje:');
  s.controller.start();
  const rec = s.recognizers[0];
  rec.onresult(results(['buen', false]));
  assert.equal(s.text(), 'Mensaje:');
  rec.onresult(results(['buen día', true]));
  rec.onresult(results(['buen día', true], ['buen día', true]));
  assert.equal(s.text(), 'Mensaje: buen día');
  assert.equal(s.controller.active, false);
  assert.equal(rec.aborts, 1);
});
test('una lista de hipótesis acumuladas no se concatena como frases nuevas', () => {
  const s = setup('Papá:');
  s.controller.start();
  s.recognizers[0].onresult(results(['voy', true], ['voy para', true], ['voy para la casa', true]));
  assert.equal(s.text(), 'Papá: voy para la casa');
});
test('conserva repeticiones pronunciadas y permite dictar otra frase al reactivar', () => {
  const s = setup();
  s.controller.start();
  const first = s.recognizers[0];
  first.onresult(results(['no no, estoy bien', true]));
  s.controller.start();
  first.onresult(results(['no no, estoy bien', true]));
  s.recognizers[1].onresult(results(['gracias gracias', true]));
  assert.equal(s.text(), 'no no, estoy bien gracias gracias');
});
test('detener durante el permiso ignora onstart y resultados tardíos', () => {
  const s = setup('Conservar');
  s.controller.start();
  const rec = s.recognizers[0];
  s.controller.stop();
  rec.onstart();
  rec.onresult(results(['otro chat', true]));
  assert.equal(s.controller.active, false);
  assert.equal(rec.aborts, 1);
  assert.equal(s.text(), 'Conservar');
  assert.deepEqual(s.states, ['starting', 'idle']);
});
test('eventos de una sesión anterior no cierran una sesión nueva', () => {
  const s = setup();
  s.controller.start();
  const old = s.recognizers[0];
  s.controller.stop();
  s.controller.start();
  old.onend();
  old.onerror({ error: 'not-allowed' });
  old.onresult(results(['tardío', true]));
  assert.equal(s.controller.active, true);
  assert.equal(s.text(), '');
  assert.deepEqual(s.errors, []);
});
test('un error de permiso limpia el estado y permite reintentar', () => {
  const s = setup();
  s.controller.start();
  s.recognizers[0].onerror({ error: 'not-allowed' });
  assert.equal(s.controller.active, false);
  assert.deepEqual(s.errors, ['not-allowed']);
  s.controller.start();
  assert.equal(s.recognizers.length, 2);
});
test('respeta el límite del mensaje y conserva el texto al terminar', () => {
  const s = setup('Hola', 10);
  s.controller.start();
  s.recognizers[0].onresult(results(['cómo estás', true]));
  s.recognizers[0].onend();
  assert.equal(s.text(), 'Hola cómo ');
  assert.equal(s.controller.active, false);
});
test('informa si no hay soporte o si el servicio no logra iniciar', () => {
  const errors = [];
  for (const factory of [() => null, () => { throw new Error('No disponible'); }, () => ({ start() { throw new Error('Bloqueado'); } })]) {
    const controller = createDictation({ createRecognition: factory, getText: () => '', setText() {}, onState() {}, onError: (error) => errors.push(error) });
    controller.start();
    assert.equal(controller.active, false);
  }
  assert.deepEqual(errors, ['unsupported', 'unavailable', 'unavailable']);
});
