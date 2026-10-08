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
  // The browser preview and Android DB must both start empty. No financial fixtures.
  const emptyBudget = () => ({ incomeCents: 0, recurring: [], entries: [] });
  const previewStorageKey = 'bolso_preview_v2';
  function getDemo() {
    try { const stored = JSON.parse(localStorage.getItem(previewStorageKey)); if (stored && Array.isArray(stored.recurring) && Array.isArray(stored.entries)) return stored; } catch (_) { /* preview only */ }
    return emptyBudget();
  }
  function persistDemo(next) { localStorage.setItem(previewStorageKey,JSON.stringify({ incomeCents:next.incomeCents, recurring:next.recurring, entries:next.entries })); }
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
    const noIncome = sum.incomeCents === 0;
    const empty = data.incomeCents === 0 && data.recurring.length === 0 && data.entries.length === 0;
    $('onboarding').hidden = !empty;
    $('balanceMessage').textContent = noIncome ? (sum.spentCents > 0 ? 'Há gastos sem renda cadastrada' : 'Cadastre sua renda para começar') :
      (sum.remainingCents < 0 ? 'Atenção: despesas acima da renda' : 'Após suas despesas previstas');
    $('balancePercent').textContent = noIncome ? 'Sem renda' : (sum.remainingCents < 0 ? 'Acima do limite' : `${sum.availablePercent}% livre`);
    $('balancePercent').classList.toggle('negative',sum.remainingCents < 0);
    $('spentPercent').textContent = noIncome ? 'Sem renda cadastrada' : `${sum.percent}% comprometido`;
    $('freePercent').textContent = noIncome ? '— disponível' : `${sum.availablePercent}% disponível`;
    const percent = noIncome ? 0 : Math.max(0, Math.min(100, sum.percent));
    $('ratioFill').style.width = `${percent}%`;
    $('donutPercent').textContent = noIncome ? '—' : `${sum.percent}%`;
    $('donut').style.background = noIncome ? '#284457' : `conic-gradient(#ffca7b 0 ${percent}%, #215849 ${percent}% 100%)`;
    $('fixedAmount').textContent = currency(sum.fixedCents);
    $('variableAmount').textContent = currency(sum.expensesCents);
    $('leftAmount').textContent = currency(sum.remainingCents);
    $('incomeSetting').textContent = data.incomeCents ? currency(data.incomeCents) : 'Não cadastrada';
    renderEntries(); renderBills();
  }
  function renderEntries() {
    if (!snapshot.entries.length) {
      $('entriesList').innerHTML = `<div class="empty-state">${icon('wallet')}Nenhum lançamento em ${safe(labelMonth(month))}.<br/>Fale ou registre um gasto manualmente.<button type="button" id="emptyNewEntry">${icon('plus')} Criar lançamento</button></div>`;
      return;
    }
    $('entriesList').innerHTML = snapshot.entries.map(entry => `<div class="list-row">
      <div class="category-icon">${categoryEmoji(entry.category)}</div><div class="list-info"><strong>${safe(entry.title)}</strong><small>${safe(entry.category)} · ${safe(entry.date.split('-').reverse().join('/'))} ${entry.source === 'voice' ? '· 🎙 Voz' : (entry.source === 'whatsapp' ? '· WhatsApp' : '')}</small></div>
      <div class="list-amount ${entry.kind}">${entry.kind === 'income' ? '+' : '−'}${safe(currency(entry.cents))}</div>
      <button class="row-options" aria-label="Editar lançamento ${safe(entry.title)}" data-edit-entry="${entry.id}">${icon('edit')}</button>
      <button class="row-options" aria-label="Excluir lançamento ${safe(entry.title)}" data-del-entry="${entry.id}">${icon('trash')}</button></div>`).join('');
  }
  function renderBills() {
    if (!snapshot.recurring.length) { $('billsList').innerHTML = '<div class="empty-state">Nenhuma conta cadastrada.<button type="button" id="emptyNewBill">+ Adicionar minha primeira conta</button></div>'; return; }
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
  function entrySheet(item, existingId = 0) {
    const draft = item || {kind:'expense',cents:0,category:'Outros',description:'',date:today()};
    const categories = ['Entradas',...Logic.categories.map(c=>c.name)];
    openSheet(existingId ? 'Editar lançamento' : (item ? 'Confirme seu lançamento' : 'Novo lançamento'),
      `${item && !existingId ? `<div class="preview-callout">${icon('check')}Entendi! Confira a categoria e o valor antes de salvar.</div>` : ''}
      <form id="entryForm">
      <label class="field"><span>TIPO</span><select id="formKind"><option value="expense" ${draft.kind === 'expense'?'selected':''}>Despesa</option><option value="income" ${draft.kind === 'income'?'selected':''}>Entrada / recebimento</option></select></label>
      <label class="field"><span>DESCRIÇÃO</span><input id="formDescription" maxlength="160" required placeholder="Ex.: bolachas e salgadinhos" value="${safe(draft.description)}"/></label>
      <div class="field-grid"><label class="field"><span>VALOR (R$)</span><input id="formAmount" type="text" inputmode="decimal" required placeholder="50,00" value="${draft.cents ? safe(formatEdit(draft.cents)) : ''}"/></label>
      <label class="field"><span>DATA</span><input id="formDate" type="date" required value="${safe(draft.date)}"/></label></div>
      <label class="field"><span>CATEGORIA</span><select id="formCategory">${categories.map(cat => `<option ${cat === draft.category ? 'selected' : ''}>${safe(cat)}</option>`).join('')}</select></label>
      <button class="primary-button" type="submit">${icon('check')} ${existingId ? 'Atualizar' : 'Salvar'} lançamento</button>
      </form>`, 'LANÇAMENTO INTELIGENTE');
    $('entryForm').addEventListener('submit',e => {
      e.preventDefault();
      const kind = $('formKind').value;
      const cents = Logic.parseAmount($('formAmount').value);
      if (!cents) return showError('Informe um valor válido, como 50,00');
      const description = $('formDescription').value.trim();
      const date = $('formDate').value;
      if (!description || description.length > 160 || !Logic.validDay(date)) return showError('Confira a descrição e a data');
      const category = kind === 'income' ? 'Entradas' : $('formCategory').value;
      if (native) {
        if (existingId) window.BolsoNative.updateEntry(existingId,kind,cents,description,category,date);
        else window.BolsoNative.saveEntry(kind,cents,description,category,date,pendingSource);
      } else previewUpdate(db => {
        if (existingId) { const row=db.entries.find(x=>x.id===existingId); if(row) Object.assign(row,{kind,cents,title:description,category,date}); }
        else db.entries.push({id:Date.now(),kind,cents,title:description,category,date,source:pendingSource});
      });
      closeSheet(); $('smartInput').value = '';
      if (!native) toast(existingId ? 'Lançamento atualizado' : 'Lançamento registrado');
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
    $('incomeForm').addEventListener('submit',e => {e.preventDefault(); const raw=$('incomeEdit').value.trim();const cents=/^0+(?:[,.]0{1,2})?$/.test(raw)?0:Logic.parseAmount(raw); if(cents===null)return showError('Informe uma renda válida. Use 0 para deixar sem renda.');if(native)window.BolsoNative.saveIncome(cents);else previewUpdate(db => {db.incomeCents=cents;});closeSheet();if(!native)toast('Renda atualizada');});
  }
  function billSheet(item) {
    const bill = item || {id:0,title:'',category:'Outros',cents:0,fromMonth:month,untilMonth:null};
    openSheet(item ? 'Editar conta fixa' : 'Adicionar conta fixa', `<form id="billForm"><label class="field"><span>DESCRIÇÃO</span><input id="billName" maxlength="160" required value="${safe(bill.title)}" placeholder="Ex.: Internet"/></label><div class="field-grid"><label class="field"><span>VALOR R$</span><input id="billAmount" required inputmode="decimal" value="${bill.cents ? safe(formatEdit(bill.cents)) : ''}" placeholder="250,00"/></label><label class="field"><span>CATEGORIA</span><select id="billCategory">${Logic.categories.map(c=>`<option ${c.name === bill.category ? 'selected':''}>${safe(c.name)}</option>`).join('')}</select></label></div><div class="field-grid"><label class="field"><span>PRIMEIRO MÊS</span><input id="billFrom" type="month" required value="${safe(bill.fromMonth || month)}"/></label><label class="field"><span>ÚLTIMO MÊS (opcional)</span><input id="billUntil" type="month" value="${safe(bill.untilMonth || '')}"/></label></div><div class="preview-callout">${icon('calendar')}Sem um mês final, a conta continua todos os meses.</div><button class="primary-button" type="submit">${icon('check')} Salvar conta</button>${item ? '<button type="button" class="danger-button" id="deleteBill">Excluir esta conta</button>' : ''}</form>`, 'DESPESA RECORRENTE');
    $('billForm').addEventListener('submit',e => {e.preventDefault();const cents=Logic.parseAmount($('billAmount').value),name=$('billName').value.trim(),cat=$('billCategory').value,from=$('billFrom').value,until=$('billUntil').value;if(!cents||!name)return showError('Confira a descrição e o valor');if(!from||(until&&until<from))return showError('Confira os meses de início e término');if(native)window.BolsoNative.saveBill(bill.id,name,cat,cents,from,until);else previewUpdate(db=>{if(bill.id){const target=db.recurring.find(x=>x.id===bill.id);if(target)Object.assign(target,{title:name,cents,category:cat,fromMonth:from,untilMonth:until||null});}else db.recurring.push({id:Date.now(),title:name,cents,category:cat,fromMonth:from,untilMonth:until||null});});closeSheet();if(!native)toast('Conta salva');});
    if (item) $('deleteBill').addEventListener('click',()=>{if(!confirm('Excluir esta conta recorrente?'))return;if(native)window.BolsoNative.deleteBill(bill.id);else previewUpdate(db => {db.recurring=db.recurring.filter(x=>x.id!==bill.id);});closeSheet();if(!native)toast('Conta excluída');});
  }
  function resetSheet() {
    openSheet('Recomeçar do zero', `<div class="preview-callout">${icon('trash')}Isso remove permanentemente renda, contas e lançamentos salvos neste aparelho. Exporte seu histórico antes, se quiser guardar uma cópia.</div>
      <form id="resetForm"><label class="field"><span>DIGITE APAGAR PARA CONFIRMAR</span><input id="resetConfirm" autocomplete="off" autocapitalize="characters" required maxlength="12" placeholder="APAGAR"/></label>
      <button type="submit" class="primary-button">${icon('trash')} Apagar meus dados</button></form>`, 'EXCLUSÃO DEFINITIVA');
    $('resetForm').addEventListener('submit', e => {
      e.preventDefault();
      if ($('resetConfirm').value.trim().toUpperCase() !== 'APAGAR') return showError('Digite APAGAR para confirmar a exclusão.');
      if (native) window.BolsoNative.resetAll();
      else { persistDemo(emptyBudget()); load(month); toast('Dados apagados'); }
      closeSheet();
    });
  }
  function exportCsv() {
    if (native) window.BolsoNative.exportCsv();
    else {
      // Browser preview: app itself always uses Android's secure save dialog.
      toast('A exportação CSV está disponível no aplicativo Android.');
    }
  }
  function waState(result) {
    if (!result || typeof result !== 'object') return;
    const linked = result.linked === true;
    $('waStatusText').textContent = linked ? 'Conectado com segurança' : 'Não conectado';
    $('waStatusDot').classList.toggle('connected', linked);
    $('waCodeBox').hidden = !result.code;
    if (result.command) $('waCodeText').textContent = result.command;
    $('waSyncButton').disabled = !linked;
    $('waUnlinkButton').hidden = !linked;
    if (linked && result.imported !== undefined) {
      toast(`${result.imported} lançamento(s) sincronizado(s).`);
      if (result.more) toast('Importação parcial: repita a sincronização.');
    }
    if (!linked && result.configured === false) $('waCodeBox').hidden = true;
  }
  function waAvailable() {
    if (!native) { showError('Conecte usando o APK Android. A prévia não acessa o servidor.'); return false; }
    return true;
  }
  function back() { if ($('overlay').classList.contains('open')) closeSheet(); else if (page !== 'dashboard') showPage('dashboard'); else toast('Você está no resumo financeiro'); }
  window.Bolso = { renderData, waState, receiveSpeech: result => { $('smartInput').value = result; interpret(result,'voice'); }, showError, toast, back };
  $('prevMonth').addEventListener('click',()=>changeMonth(-1));
  $('nextMonth').addEventListener('click',()=>changeMonth(1));
  for (const btn of document.querySelectorAll('[data-step]')) btn.addEventListener('click',()=>changeMonth(Number(btn.dataset.step)));
  $('forecastButton').addEventListener('click',()=>{const next=Logic.moveMonth(month,1);load(next);toast('Previsão de '+labelMonth(next));});
  $('micButton').addEventListener('click',()=>native ? window.BolsoNative.speak() : showError('O microfone funciona no APK Android. Na prévia, digite seu gasto.'));
  $('parseButton').addEventListener('click',()=>{ const text=$('smartInput').value.trim(); if(!text){pendingSource='text';entrySheet(null);}else interpret(text,'text'); });
  $('smartInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('parseButton').click();}});
  $('seeBills').addEventListener('click',()=>showPage('billsPage'));
  $('manualNewEntry').addEventListener('click',()=>{pendingSource='text';entrySheet(null);});
  $('changeIncome').addEventListener('click',incomeSheet);
  $('quickIncome').addEventListener('click',incomeSheet);
  $('quickBill').addEventListener('click',()=>billSheet(null));
  $('resetButton').addEventListener('click',resetSheet);
  $('waPairButton').addEventListener('click', () => {
    if (waAvailable()) window.BolsoNative.waStart($('waEndpoint').value.trim());
  });
  $('waVerifyButton').addEventListener('click', () => { if (waAvailable()) window.BolsoNative.waStatus(); });
  $('waSyncButton').addEventListener('click', () => { if (waAvailable()) window.BolsoNative.waSync(); });
  $('waUnlinkButton').addEventListener('click', () => {
    if (waAvailable() && confirm('Desvincular este aparelho? Os lançamentos que já estão no celular serão mantidos.')) window.BolsoNative.waUnlink();
  });
  $('newBill').addEventListener('click',()=>billSheet(null));
  $('exportButton').addEventListener('click',exportCsv);
  $('closeSheet').addEventListener('click',closeSheet);
  $('overlay').addEventListener('click',e=>{if(e.target===$('overlay'))closeSheet();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')back();});
  document.querySelectorAll('.nav-item').forEach(el=>el.addEventListener('click',()=>{showPage(el.dataset.page);if(el.dataset.page==='whatsappPage'&&native)window.BolsoNative.waStatus();}));
  $('entriesList').addEventListener('click',e=>{
    if (e.target.closest('#emptyNewEntry')) {pendingSource='text';entrySheet(null);return;}
    const edit = e.target.closest('[data-edit-entry]');
    if (edit && snapshot) {
      const item=snapshot.entries.find(x=>x.id===Number(edit.dataset.editEntry));
      if (item) {pendingSource=item.source;entrySheet({...item, description:item.title}, item.id);}
      return;
    }
    const btn=e.target.closest('[data-del-entry]');if(!btn)return;
    if(!confirm('Excluir este lançamento?'))return;
    const id=Number(btn.dataset.delEntry);
    if(native)window.BolsoNative.deleteEntry(id);
    else {previewUpdate(db=>{db.entries=db.entries.filter(x=>x.id!==id);});toast('Lançamento excluído');}
  });
  $('billsList').addEventListener('click',e=>{
    if(e.target.closest('#emptyNewBill')){billSheet(null);return;}
    const btn=e.target.closest('[data-edit-bill]');if(!btn||!snapshot)return;
    const bill=snapshot.recurring.find(x=>x.id===Number(btn.dataset.editBill));if(bill)billSheet(bill);
  });
  if (!native) load(month);
})();
