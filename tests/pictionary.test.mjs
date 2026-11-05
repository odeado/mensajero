import test from 'node:test';
import assert from 'node:assert/strict';
import { newState, pictionaryMove, PICTIONARY_ROUND_MS, PICTIONARY_REVEAL_MS } from '../js/games-logic.js';
const start = 100_000;
const state = (extra = {}) => ({ ...newState('pictionary'), word:'ratón', roundStartedAt:start, ...extra });
test('Pictionary empieza a contar al arrancar la ronda y rechaza terminar antes', () => {
  const waiting = newState('pictionary');
  assert.equal(pictionaryMove(waiting, 1, {type:'guess',text:waiting.word}, start), null);
  assert.equal(pictionaryMove(waiting, 0, {type:'startClock'}, start).roundStartedAt, start);
  assert.equal(pictionaryMove(state(), 1, {type:'timeout'}, start + PICTIONARY_ROUND_MS - 1), null);
});
test('al llegar al límite revela la palabra sin puntos y alterna automáticamente', () => {
  const time = start + PICTIONARY_ROUND_MS;
  const ended = pictionaryMove(state(), 0, {type:'timeout',round:1}, time);
  assert.equal(ended.roundOutcome, 'timeout');
  assert.deepEqual(ended.score,[0,0]);
  assert.equal(ended.word,'ratón');
  assert.equal(pictionaryMove(ended,1,{type:'nextRound'},time + PICTIONARY_REVEAL_MS - 1),null);
  const next = pictionaryMove(ended,1,{type:'nextRound',round:1},time + PICTIONARY_REVEAL_MS);
  assert.equal(next.drawer,1); assert.equal(next.round,2);
  assert.equal(next.phase,'drawing'); assert.deepEqual(next.strokes,[]);
  assert.equal(next.roundStartedAt,time + PICTIONARY_REVEAL_MS);
});
test('acertar normaliza tildes y concede un solo punto', () => {
  const won = pictionaryMove(state(),1,{type:'guess',text:' RATON '},start+1000);
  assert.equal(won.roundOutcome,'guessed'); assert.deepEqual(won.score,[0,1]);
  assert.equal(pictionaryMove(won,1,{type:'guess',text:'ratón'},start+1001),null);
});
test('no acepta respuestas tardías ni acciones de otra ronda', () => {
  assert.equal(pictionaryMove(state(),1,{type:'guess',text:'ratón'},start+PICTIONARY_ROUND_MS),null);
  assert.equal(pictionaryMove(state(),1,{type:'guess',text:'ratón',round:0},start+1),null);
  assert.equal(pictionaryMove(state(),0,{type:'guess',text:'ratón'},start+1),null);
  const next = state({round:2,drawer:1});
  assert.equal(pictionaryMove(next,0,{type:'timeout',round:1},start+PICTIONARY_ROUND_MS),null);
});
test('también termina la partida si se agota la quinta ronda', () => {
  const last = state({round:5,score:[2,1]});
  const ended = pictionaryMove(last,1,{type:'timeout'},start+PICTIONARY_ROUND_MS);
  assert.equal(ended.winner,0); assert.equal(ended.phase,'gameOver');
  assert.equal(pictionaryMove(ended,1,{type:'nextRound'},start+100_000),null);
});
