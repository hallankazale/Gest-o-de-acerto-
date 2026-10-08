(function () {
  'use strict';
  const Logic = window.BolsoLogic;
  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const currentMonth = () => today().slice(0, 7);
  const native = !!window.BolsoNative;
  let month = currentMonth();
  let page = 'dashboard';
  let snapshot = null;
  let toastTimer;
  let pendingSource = 'text';
  const demo = { incomeCents: 390000, recurring: [
    {id:1,title:'Aluguel',category:'Moradia',cents:90000,fromMonth:'2026-01',untilMonth:null},
    {id:2,title:'Água e luz',category:'Moradia',cents:25000,fromMonth:'2026-01',untilMonth:null},
    {id:3,title:'Pensão 1',category:'Pensões',cents:54200,fromMonth:'2026-01',untilMonth:null},
    {id:4,title:'Pensão 2',category:'Pensões',cents:40000,fromMonth:'2026-01',untilMonth:null},
    {id:5,title:'Móveis',category:'Compras',cents:41200,fromMonth:'2026-01',untilMonth:'2027-02'},
    {id:6,title:'Ana Loja',category:'Compras',cents:30000,fromMonth:'2026-01',untilMonth:'2027-02'}
  ], entries: [] };
  function getDemo() {
    try { const stored = JSON.parse(localStorage.getItem('bolso_preview')); if (stored && Array.isArray(stored.recurring) && Array.isArray(stored.entries)) return stored; } catch (_) { /* preview only */ }
    return demo;
  }
  function persistDemo(next) { localStorage.setItem('bolso_preview',JSON.stringify({ incomeCents:next.incomeCents, recurring:next.recurring, entries:next.entries })); }
  function previewUpdate(action) {
    const state = getDemo(); action(state); persistDemo(state);
    window.Bolso.renderData({ ...state, month, entries:state.entries.filter(e => e.date.startsWith(month)) });
  }
  const currency = cents => Logic.money(cents);
  const formatEdit = cents => (cents / 100).toFixed(2).replace('.', ',');
  const labelMonth = ym => new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone:'UTC' }).format(new Date(ym + '-01T12:00:00Z')).replace(/^./, c => c.toUpperCase());
  const categoryEmoji = label => ({ 'Alimentação':'🛒','Transporte':'🚗','Moradia':'🏠','Pensões':'👨‍👧','Saúde':'💚','Compras':'🛍','Lazer':'🎮','Outros':'◈','Entradas':'↗' }[label] || '◈');
  const icon = name => `<svg aria-hidden="true"><use href="#${name}"/></svg>`;
  function showPage(next) {
    if (!$(next)) return;
    page = next;
    for (const el of document.querySelectorAll('.page')) el.classList.toggle('active', el.id === page);
    for (const el of document.querySelectorAll('.nav-item')) el.classList.toggle('selected', el.dataset.page === page);
    window.scrollTo({top:0,behavior:'instant'});
  }
  function showError(msg) { toast(msg || 'Não foi possível concluir a operação'); }
  function toast(message) {
    const el = $('toast'); el.textContent = String(message); el.classList.add('shown');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('shown'), 3400);
  }
  function changeMonth(step) { const next = Logic.moveMonth(month,step); load(next); }
  function load(ym) {
    month = ym;
    if (native) window.BolsoNative.load(ym);
    else { const db = getDemo(); window.Bolso.renderData({...db,month:ym,entries:db.entries.filter(e => e.date.startsWith(ym))}); }
  }
  function renderData(data) {
    if (!data || !Array.isArray(data.entries) || !Array.isArray(data.recurring)) return showError('Os dados não foram carregados corretamente');
    snapshot = data; month = data.month;
    const sum = Logic.monthlySummary(data);
    $('monthTitle').textContent = labelMonth(month);
    $('entryMonthTitle').textContent = labelMonth(month);
    $('incomeAmount').textContent = currency(sum.incomeCents);
    $('spentAmount').textContent = currency(sum.spentCents);
    $('balanceAmount').textContent = currency(sum.remainingCents);
    $('balanceAmount').classList.toggle('negative',sum.remainingCents < 0);
    $('balanceMessage').textContent = sum.remainingCents < 0 ? 'Atenção: despesas acima da renda' : 'Após suas despesas previstas';
    $('balancePercent').textContent = sum.remainingCents < 0 ? 'Acima do limite' : `${sum.availablePercent}% livre`;
    $('balancePercent').classList.toggle('negative',sum.remainingCents < 0);
    $('spentPercent').textContent = `${sum.percent}% comprometido`;
    $('freePercent').textContent = `${sum.availablePercent}% disponível`;
    $('ratioFill').style.width = `${Math.max(0,Math.min(100,sum.percent))}%`;
    $('donutPercent').textContent = `${sum.percent}%`;
    $('donut').style.background = `conic-gradient(#ffca7b 0 ${Math.max(0,Math.min(100,sum.percent))}%, #215849 ${Math.max(0,Math.min(100,sum.percent))}% 100%)`;
    $('fixedAmount').textContent = currency(sum.fixedCents);
    $('variableAmount').textContent = currency(sum.expensesCents);
    $('leftAmount').textContent = currency(sum.remainingCents);
    $('incomeSetting').textContent = currency(data.incomeCents);
    renderEntries(); renderBills();
  }
  function renderEntries() {
    if (!snapshot.entries.length) {
      $('entriesList').innerHTML = `<div class="empty-state">${icon('wallet')}Nenhum lançamento em ${safe(labelMonth(month))}.<br/>Use a voz ou o campo de texto para começar.</div>`;
      return;
    }
    $('entriesList').innerHTML = snapshot.entries.map(entry => `<div class="list-row">
      <div class="category-icon">${categoryEmoji(entry.category)}</div><div class="list-info"><strong>${safe(entry.title)}</strong><small>${safe(entry.category)} · ${safe(entry.date.split('-').reverse().join('/'))} ${entry.source === 'voice' ? '· 🎙 Voz' : ''}</small></div>
      <div class="list-amount ${entry.kind}">${entry.kind === 'income' ? '+' : '−'}${safe(currency(entry.cents))}</div>
      <button class="row-options" aria-label="Excluir lançamento ${safe(entry.title)}" data-del-entry="${entry.id}">${icon('trash')}</button></div>`).join('');
  }
  function renderBills() {
    if (!snapshot.recurring.length) { $('billsList').innerHTML = '<div class="empty-state">Nenhuma conta cadastrada.</div>'; return; }
    $('billsList').innerHTML = snapshot.recurring.map(bill => `<div class="list-row">
      <div class="category-icon">${categoryEmoji(bill.category)}</div><div class="list-info"><strong>${safe(bill.title)}</strong><small>${safe(bill.category)} · ${bill.untilMonth ? 'Até '+safe(labelMonth(bill.untilMonth)) : 'Todo mês'}</small></div>
      <div class="list-amount expense">${safe(currency(bill.cents))}</div>
      <button class="row-options" aria-label="Editar ${safe(bill.title)}" data-edit-bill="${bill.id}">${icon('edit')}</button></div>`).join('');
  }
  function openSheet(title, html, eyebrow) {
    $('sheetTitle').textContent = title;
    $('sheetEyebrow').textContent = eyebrow || 'CONFIRME OS DETALHES';
    $('sheetContent').innerHTML = html;
    $('overlay').classList.add('open'); $('overlay').setAttribute('aria-hidden','false');
  }
  function closeSheet() { $('overlay').classList.remove('open'); $('overlay').setAttribute('aria-hidden','true'); }
  function entrySheet(item) {
    const draft = item || {kind:'expense',cents:0,category:'Outros',description:'',date:today()};
    const categories = ['Entradas',...Logic.categories.map(c=>c.name)];
    openSheet(item ? 'Confirme seu lançamento' : 'Novo lançamento',
      `${item ? `<div class="preview-callout">${icon('check')}Entendi! Confira a categoria e o valor antes de salvar.</div>` : ''}
      <form id="entryForm">
      <label class="field"><span>TIPO</span><select id="formKind"><option value="expense" ${draft.kind === 'expense'?'selected':''}>Despesa</option><option value="income" ${draft.kind === 'income'?'selected':''}>Entrada / recebimento</option></select></label>
      <label class="field"><span>DESCRIÇÃO</span><input id="formDescription" maxlength="160" required placeholder="Ex.: bolachas e salgadinhos" value="${safe(draft.description)}"/></label>
      <div class="field-grid"><label class="field"><span>VALOR (R$)</span><input id="formAmount" type="text" inputmode="decimal" required placeholder="50,00" value="${draft.cents ? safe(formatEdit(draft.cents)) : ''}"/></label>
      <label class="field"><span>DATA</span><input id="formDate" type="date" required value="${safe(draft.date)}"/></label></div>
      <label class="field"><span>CATEGORIA</span><select id="formCategory">${categories.map(cat => `<option ${cat === draft.category ? 'selected' : ''}>${safe(cat)}</option>`).join('')}</select></label>
      <button class="primary-button" type="submit">${icon('check')} Salvar lançamento</button>
      </form>`, 'LANÇAMENTO INTELIGENTE');
    $('entryForm').addEventListener('submit',e => {
      e.preventDefault();
      const kind = $('formKind').value;
      const cents = Logic.parseAmount($('formAmount').value);
      if (!cents) return showError('Informe um valor válido, como 50,00');
      const description = $('formDescription').value.trim();
      const date = $('formDate').value;
      if (!description || description.length > 160 || !/^\d{4}-\d\d-\d\d$/.test(date) || Number.isNaN(Date.parse(date+'T12:00:00'))) return showError('Confira a descrição e a data');
      const category = kind === 'income' ? 'Entradas' : $('formCategory').value;
      if (native) window.BolsoNative.saveEntry(kind,cents,description,category,date,pendingSource);
      else previewUpdate(db => db.entries.push({id:Date.now(),kind,cents,title:description,category,date,source:pendingSource}));
      closeSheet(); $('smartInput').value = ''; toast('Lançamento registrado');
      if (date.slice(0,7) !== month) load(date.slice(0,7));
    });
  }
  function interpret(text, source) {
    const draft = Logic.parseMessage(text,today());
    if (draft.error) return showError(draft.error);
    pendingSource = source;
    entrySheet(draft);
  }
  function incomeSheet() {
    openSheet('Editar renda mensal',`<form id="incomeForm"><label class="field"><span>RENDA FIXA EM R$</span><input id="incomeEdit" required inputmode="decimal" value="${safe(formatEdit(snapshot.incomeCents))}"/></label><div class="preview-callout">${icon('spark')}A renda será utilizada em todos os meses. Entradas extras ficam no histórico.</div><button class="primary-button" type="submit">${icon('check')} Salvar renda</button></form>`, 'CONFIGURAÇÃO DO ORÇAMENTO');
    $('incomeForm').addEventListener('submit',e => {e.preventDefault(); const cents=Logic.parseAmount($('incomeEdit').value); if(!cents)return showError('Valor inválido');if(native)window.BolsoNative.saveIncome(cents);else previewUpdate(db => {db.incomeCents=cents;});closeSheet();toast('Renda atualizada');});
  }
  function billSheet(item) {
    const bill = item || {id:0,title:'',category:'Outros',cents:0,fromMonth:month,untilMonth:null};
    openSheet(item ? 'Editar conta fixa' : 'Adicionar conta fixa', `<form id="billForm"><label class="field"><span>DESCRIÇÃO</span><input id="billName" maxlength="160" required value="${safe(bill.title)}" placeholder="Ex.: Internet"/></label><div class="field-grid"><label class="field"><span>VALOR R$</span><input id="billAmount" required inputmode="decimal" value="${bill.cents ? safe(formatEdit(bill.cents)) : ''}" placeholder="250,00"/></label><label class="field"><span>CATEGORIA</span><select id="billCategory">${Logic.categories.map(c=>`<option ${c.name === bill.category ? 'selected':''}>${safe(c.name)}</option>`).join('')}</select></label></div><div class="field-grid"><label class="field"><span>PRIMEIRO MÊS</span><input id="billFrom" type="month" required value="${safe(bill.fromMonth || month)}"/></label><label class="field"><span>ÚLTIMO MÊS (opcional)</span><input id="billUntil" type="month" value="${safe(bill.untilMonth || '')}"/></label></div><div class="preview-callout">${icon('calendar')}Sem um mês final, a conta continua todos os meses.</div><button class="primary-button" type="submit">${icon('check')} Salvar conta</button>${item ? '<button type="button" class="danger-button" id="deleteBill">Excluir esta conta</button>' : ''}</form>`, 'DESPESA RECORRENTE');
    $('billForm').addEventListener('submit',e => {e.preventDefault();const cents=Logic.parseAmount($('billAmount').value),name=$('billName').value.trim(),cat=$('billCategory').value,from=$('billFrom').value,until=$('billUntil').value;if(!cents||!name)return showError('Confira a descrição e o valor');if(!from||(until&&until<from))return showError('Confira os meses de início e término');if(native)window.BolsoNative.saveBill(bill.id,name,cat,cents,from,until);else previewUpdate(db=>{if(bill.id){const target=db.recurring.find(x=>x.id===bill.id);if(target)Object.assign(target,{title:name,cents,category:cat,fromMonth:from,untilMonth:until||null});}else db.recurring.push({id:Date.now(),title:name,cents,category:cat,fromMonth:from,untilMonth:until||null});});closeSheet();toast('Conta salva');});
    if (item) $('deleteBill').addEventListener('click',()=>{if(!confirm('Excluir esta conta recorrente?'))return;if(native)window.BolsoNative.deleteBill(bill.id);else previewUpdate(db => {db.recurring=db.recurring.filter(x=>x.id!==bill.id);});closeSheet();toast('Conta excluída');});
  }
  function exportCsv() {
    if (native) window.BolsoNative.exportCsv();
    else {
      // Browser preview: app itself always uses Android's secure save dialog.
      toast('A exportação CSV está disponível no aplicativo Android.');
    }
  }
  function back() { if ($('overlay').classList.contains('open')) closeSheet(); else if (page !== 'dashboard') showPage('dashboard'); else toast('Você está no resumo financeiro'); }
  window.Bolso = { renderData, receiveSpeech: result => { $('smartInput').value = result; interpret(result,'voice'); }, showError, toast, back };
  $('prevMonth').addEventListener('click',()=>changeMonth(-1));
  $('nextMonth').addEventListener('click',()=>changeMonth(1));
  for (const btn of document.querySelectorAll('[data-step]')) btn.addEventListener('click',()=>changeMonth(Number(btn.dataset.step)));
  $('forecastButton').addEventListener('click',()=>{load('2027-03');toast('Previsão de março de 2027');});
  $('micButton').addEventListener('click',()=>native ? window.BolsoNative.speak() : showError('O microfone funciona no APK Android. Na prévia, digite seu gasto.'));
  $('parseButton').addEventListener('click',()=>{ const text=$('smartInput').value.trim(); if(!text){pendingSource='text';entrySheet(null);}else interpret(text,'text'); });
  $('smartInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('parseButton').click();}});
  $('seeBills').addEventListener('click',()=>showPage('billsPage'));
  $('manualNewEntry').addEventListener('click',()=>{pendingSource='text';entrySheet(null);});
  $('changeIncome').addEventListener('click',incomeSheet);
  $('newBill').addEventListener('click',()=>billSheet(null));
  $('exportButton').addEventListener('click',exportCsv);
  $('closeSheet').addEventListener('click',closeSheet);
  $('overlay').addEventListener('click',e=>{if(e.target===$('overlay'))closeSheet();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')back();});
  document.querySelectorAll('.nav-item').forEach(el=>el.addEventListener('click',()=>showPage(el.dataset.page)));
  $('entriesList').addEventListener('click',e=>{const btn=e.target.closest('[data-del-entry]');if(!btn)return;if(!confirm('Excluir este lançamento?'))return;const id=Number(btn.dataset.delEntry);if(native)window.BolsoNative.deleteEntry(id);else previewUpdate(db=>{db.entries=db.entries.filter(x=>x.id!==id);});toast('Lançamento excluído');});
  $('billsList').addEventListener('click',e=>{const btn=e.target.closest('[data-edit-bill]');if(!btn||!snapshot)return;const bill=snapshot.recurring.find(x=>x.id===Number(btn.dataset.editBill));if(bill)billSheet(bill);});
  if (!native) load(month);
})();
