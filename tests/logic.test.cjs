const assert = require('node:assert/strict');
const { parseMessage, parseAmount, categorize, monthlySummary, moveMonth, validDay } = require('../app/src/main/assets/logic.js');
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
test('recorrência mensal com término definido', () => {
  const s = {month:'2027-02',incomeCents:300000,entries:[],recurring:[
    {cents:100000},{cents:10000},{cents:50000,untilMonth:'2027-02'}]};
  const before = monthlySummary(s);
  assert.equal(before.fixedCents,160000); assert.equal(before.remainingCents,140000);
  s.month = '2027-03'; const after = monthlySummary(s);
  assert.equal(after.fixedCents,110000); assert.equal(after.remainingCents,190000);
  s.entries = [{kind:'expense',cents:5000}]; assert.equal(monthlySummary(s).remainingCents,185000);
});
test('navegação entre anos', () => assert.equal(moveMonth('2026-12',1),'2027-01'));
test('classificação local de transporte e saúde', () => {
  assert.equal(categorize('paguei uber'),'Transporte'); assert.equal(categorize('farmácia'),'Saúde');
});
test('orçamento novo totalmente zerado', () => {
  const empty = monthlySummary({month:'2026-10',incomeCents:0,recurring:[],entries:[]});
  assert.equal(empty.incomeCents,0);assert.equal(empty.spentCents,0);
  assert.equal(empty.remainingCents,0);assert.equal(empty.percent,null);assert.equal(empty.availablePercent,null);
});
test('gastos sem renda não indicam porcentagem enganosa', () => {
  const result = monthlySummary({month:'2026-10',incomeCents:0,recurring:[],entries:[{kind:'expense',cents:5000}]});
  assert.equal(result.remainingCents,-5000);assert.equal(result.percent,null);
});
test('percentual calculado com renda real', () => {
  const result=monthlySummary({month:'2026-10',incomeCents:100000,recurring:[{cents:25000}],entries:[]});
  assert.equal(result.percent,25); assert.equal(result.availablePercent,75);
});
test('data válida sem aceitar dia inexistente', () => {
  assert.equal(validDay('2026-02-30'),false);assert.equal(validDay('2028-02-29'),true);
  assert.equal(validDay('2026-11-31'),false);assert.equal(validDay('2026-10-08'),true);
});
test('sem contas ou rendas de exemplo nos arquivos distribuídos', () => {
  const fs = require('node:fs');
  const base = require('node:path').join(__dirname,'..');
  const db = fs.readFileSync(require('node:path').join(base,'app/src/main/java/br/com/hallankazale/bolsoplus/BudgetDatabase.java'),'utf8');
  const ui = fs.readFileSync(require('node:path').join(base,'app/src/main/assets/ui.js'),'utf8');
  const html = fs.readFileSync(require('node:path').join(base,'app/src/main/assets/index.html'),'utf8');
  assert.match(db,/setting\.put\("value", "0"\)/); assert.doesNotMatch(db, /seed\(db|390000/);
  assert.match(ui,/incomeCents: 0, recurring: \[\], entries: \[\]/);assert.doesNotMatch(ui,/incomeCents: 390000/);
  assert.match(html,/id="onboarding"/); assert.match(html,/id="resetButton"/);
});
test('áudio local contém quatro contas independentes e renda', () => {
  const fs=require('node:fs');const vm=require('node:vm');
  const source=fs.readFileSync(require('node:path').join(__dirname,'../app/src/main/assets/multi.js'),'utf8');
  const context={window:{},Intl,Date};vm.runInNewContext(source,context);
  const result=context.window.BolsoBatch.interpretFinanceBatch('100 de agua 100 de luz 100 de internet recebi 3900 salario','2026-10-08');
  assert.equal(result.error,null);assert.equal(result.items.length,4);
  assert.deepEqual(Array.from(result.items.map(x=>x.cents)),[10000,10000,10000,390000]);
  assert.deepEqual(Array.from(result.items.map(x=>x.title)),['Água','Luz','Internet','Salário']);
  assert.equal(result.items[3].kind,'income');
});
test('não associa um valor único a duas contas distintas', () => {
  const fs=require('node:fs');const vm=require('node:vm');
  const context={window:{},Intl,Date};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../app/src/main/assets/multi.js'),'utf8'),context);
  assert.ok(context.window.BolsoBatch.interpretFinanceBatch('100 de água e luz','2026-10-08').error);
});
console.log(`\n${tested} testes passaram`);
