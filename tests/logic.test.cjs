const assert = require('node:assert/strict');
const { parseMessage, parseAmount, categorize, monthlySummary, moveMonth } = require('../app/src/main/assets/logic.js');
let tested = 0;
const test = (name, fn) => { fn(); tested++; console.log('PASS', name); };
test('mensagem por voz categorizada', () => {
  const item = parseMessage('gastei 50 reais de bolachas e salgadinhos', '2026-10-08');
  assert.equal(item.cents, 5000); assert.equal(item.category, 'Alimentação'); assert.equal(item.kind, 'expense');
});
test('números PT-BR e milhares', () => {
  assert.equal(parseAmount('1.250,50'), 125050); assert.equal(parseAmount('50,90'),5090); assert.equal(parseAmount('R$ 20'),2000); assert.equal(parseAmount('0'), null); assert.equal(parseAmount('-4'),null);
});
test('valor por extenso em português', () => {
  assert.equal(parseMessage('gastei cinquenta reais de bolacha', '2026-10-08').cents,5000);
  assert.equal(parseMessage('gastei vinte e cinco reais de pizza', '2026-10-08').cents,2500);
});
test('entrada e data de ontem', () => {
  const entry = parseMessage('recebi 100,50 reais ontem', '2026-10-08');
  assert.equal(entry.kind,'income'); assert.equal(entry.cents,10050); assert.equal(entry.date,'2026-10-07');
});
test('despesa sem valor não é registrada', () => assert.ok(parseMessage('comprei pão').error));
test('recorrentes até fevereiro de 2027 e saldo após', () => {
  const s = {month:'2027-02',incomeCents:390000,entries:[],recurring:[
   {cents:90000},{cents:25000},{cents:54200},{cents:40000},{cents:41200,untilMonth:'2027-02'},{cents:30000,untilMonth:'2027-02'}]};
  const before = monthlySummary(s); assert.equal(before.fixedCents,280400); assert.equal(before.remainingCents,109600);
  s.month = '2027-03'; const after = monthlySummary(s); assert.equal(after.fixedCents,209200); assert.equal(after.remainingCents,180800);
  s.entries = [{kind:'expense',cents:5000}]; assert.equal(monthlySummary(s).remainingCents,175800);
});
test('navegação entre anos', () => assert.equal(moveMonth('2026-12',1),'2027-01'));
test('classificação local de transporte e saúde', () => {
  assert.equal(categorize('paguei uber'),'Transporte'); assert.equal(categorize('farmácia'),'Saúde');
});
console.log(`\n${tested} testes passaram`);
