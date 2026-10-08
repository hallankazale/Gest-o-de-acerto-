/* Pure financial + Portuguese language rules; exportable to the Node test runner. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BolsoLogic = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const categories = [
    { name: 'Alimentação', icon: 'shopping-bag', color: '#F8BD68', words: ['bolacha', 'biscoito', 'salgadinho', 'mercado', 'supermercado', 'comida', 'lanche', 'pizza', 'pão', 'padaria', 'açougue', 'arroz', 'feijão', 'leite', 'almoço', 'jantar', 'refrigerante', 'restaurante', 'café', 'ifood', 'delivery', 'fruta'] },
    { name: 'Transporte', icon: 'car', color: '#62C5FC', words: ['uber', '99 ', 'combustível', 'gasolina', 'etanol', 'diesel', 'posto', 'ônibus', 'passagem', 'taxi', 'táxi', 'moto', 'estacionamento', 'pedágio'] },
    { name: 'Moradia', icon: 'house', color: '#B7A1FA', words: ['aluguel', 'água', 'luz', 'energia', 'internet', 'condomínio', 'gás de cozinha'] },
    { name: 'Pensões', icon: 'users', color: '#FE9F8F', words: ['pensão', 'pensao', 'filho', 'pension'] },
    { name: 'Saúde', icon: 'heart', color: '#FB8CAA', words: ['farmácia', 'farmacia', 'remédio', 'remedio', 'dentista', 'médico', 'medico', 'consulta', 'academia', 'exame'] },
    { name: 'Compras', icon: 'package', color: '#A9B0FF', words: ['roupa', 'sapato', 'móvel', 'moveis', 'móveis', 'loja', 'celular', 'eletrodoméstico', 'presente'] },
    { name: 'Lazer', icon: 'gamepad', color: '#6EE2B5', words: ['cinema', 'jogo', 'passeio', 'show', 'viagem', 'parque', 'festa'] },
    { name: 'Outros', icon: 'dots', color: '#92A7B9', words: [] },
  ];
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const monthValid = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
  function parseAmount(value) {
    const raw = String(value || '').trim().replace(/^r\$\s*/i, '').replace(/\s/g, '');
    if (!/^\d+(?:[.,]\d+)*$/.test(raw)) return null;
    let normalized;
    if (raw.includes(',')) normalized = raw.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(?:\.\d{3})+$/.test(raw)) normalized = raw.replace(/\./g, '');
    else normalized = raw;
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
    const [whole, fraction = ''] = normalized.split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    return Number.isSafeInteger(cents) && cents > 0 && cents <= 1000000000 ? cents : null;
  }
  const units = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9 };
  const teens = { dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezassete: 17, dezessete: 17, dezoito: 18, dezenove: 19 };
  const tens = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 };
  const hundreds = { cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900 };
  const numberWords = { ...units, ...teens, ...tens, ...hundreds };
  function wordsAmount(text) {
    const t = norm(text);
    // Parse a monetary phrase ending in 'real/reais' to avoid mistaking quantities for money.
    const before = t.match(/((?:(?:[a-z]+)\s+){0,8})(?:reais|real)\b/);
    if (!before) return null;
    const words = before[1].trim().split(/\s+/);
    let parts = []; let started = false;
    for (let i = words.length - 1; i >= 0; i--) {
      if (words[i] === 'e' && started) { parts.unshift(words[i]); continue; }
      if (numberWords[words[i]] !== undefined) { parts.unshift(words[i]); started = true; continue; }
      if (started) break;
    }
    if (!started) return null;
    const total = parts.filter(word => word !== 'e').reduce((sum, w) => sum + (numberWords[w] || 0), 0);
    return total > 0 && total <= 1000 ? total * 100 : null;
  }
  function categorize(text) {
    const t = norm(text);
    for (const c of categories) if (c.words.some(word => t.includes(norm(word)))) return c.name;
    return 'Outros';
  }
  function parseMessage(message, day) {
    const full = String(message || '').trim();
    if (!full || full.length > 300) return { error: 'Digite uma frase de até 300 caracteres.' };
    const t = norm(full);
    const moneyMatch = t.match(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:reais?|r\$)?\b/);
    let cents = moneyMatch ? parseAmount(moneyMatch[1]) : null;
    if (cents == null) cents = wordsAmount(full);
    if (cents == null) return { error: 'Não identifiquei o valor. Exemplo: “gastei 50 reais de bolachas”.' };
    const income = /\b(recebi|ganhei|entrou|depositaram|recebimento|salario|salário|vendi)\b/.test(t);
    const kind = income ? 'income' : 'expense';
    const category = income ? 'Entradas' : categorize(full);
    let description = full
      .replace(/\b(?:r\$\s*)?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b|\b(?:r\$\s*)?\d+(?:[.,]\d{1,2})?\b/gi, '')
      .replace(/\b(gastei|paguei|comprei|recebi|ganhei|entrou|depositaram|vendi|reais|real|r\$|com|em|de|do|da|por|no|na|hoje|ontem)\b/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    if (description.length < 2) description = income ? 'Entrada extra' : 'Gasto registrado';
    description = description[0].toUpperCase() + description.slice(1);
    let date = day || new Date().toISOString().slice(0,10);
    if (/\bontem\b/.test(t)) {
      const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); date = d.toISOString().slice(0,10);
    }
    return { kind, cents, category, description: description.slice(0, 160), date, original: full };
  }
  function monthlySummary(snapshot) {
    const month = snapshot.month;
    if (!monthValid(month)) throw new Error('Mês inválido');
    const fixed = snapshot.recurring.filter(b => (!b.fromMonth || b.fromMonth <= month) && (!b.untilMonth || b.untilMonth >= month));
    const fixedCents = fixed.reduce((sum, b) => sum + b.cents, 0);
    const expensesCents = snapshot.entries.filter(x => x.kind === 'expense').reduce((s, e) => s + e.cents, 0);
    const extraIncome = snapshot.entries.filter(x => x.kind === 'income').reduce((s, e) => s + e.cents, 0);
    const incomeCents = snapshot.incomeCents + extraIncome;
    const spentCents = fixedCents + expensesCents;
    const remainingCents = incomeCents - spentCents;
    // A percentage without a positive income is undefined; never advertise 100% free.
    const percent = incomeCents > 0 ? Math.round(spentCents / incomeCents * 100) : null;
    return { fixed, fixedCents, expensesCents, extraIncome, incomeCents, spentCents, remainingCents, percent, availablePercent: percent === null ? null : Math.max(0, 100 - percent) };
  }
  function moveMonth(month, offset) {
    if (!monthValid(month)) throw new Error('Mês inválido');
    const [y, m] = month.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1 + offset, 1));
    return date.toISOString().slice(0, 7);
  }
  function validDay(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    const date = new Date(day + 'T12:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === day;
  }
  return { categories, money, parseAmount, categorize, parseMessage, monthlySummary, moveMonth, validDay };
});
