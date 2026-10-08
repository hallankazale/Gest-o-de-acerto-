(function (root) {
'use strict';
/**
 * Brazilian Portuguese financial dictation parser.
 * One transcript may contain several independent transactions (income + expenses).
 * Values are NEVER invented: on ambiguity, the entire batch is rejected for clarification.
 * The same parser is used for typed WhatsApp and transcribed audio messages.
 */
const categories = [
  ['Alimentação', ['bolacha','biscoito','salgadinho','mercado','supermercado','comida','lanche','pizza','pao','padaria','acougue','arroz','feijao','leite','almoco','jantar','restaurante','cafe','delivery','ifood','fruta']],
  ['Transporte', ['uber','gasolina','etanol','diesel','combustivel','posto','onibus','taxi','moto','pedagio','estacionamento']],
  ['Moradia', ['aluguel','agua','luz','energia','internet','condominio','gas de cozinha']],
  ['Pensões',['pensao','pension']],
  ['Saúde',['farmacia','remedio','dentista','medico','consulta','academia','exame']],
  ['Compras',['roupa','sapato','movel','moveis','loja','celular','eletrodomestico','presente']],
  ['Lazer',['cinema','jogo','passeio','show','viagem','parque','festa']],
];
const quickLabels = [
  ['salario','Salário','Entradas'],['pagamento','Pagamento recebido','Entradas'],
  ['agua','Água','Moradia'],['luz','Luz','Moradia'],['energia','Energia','Moradia'],
  ['internet','Internet','Moradia'],['aluguel','Aluguel','Moradia'],
  ['gasolina','Gasolina','Transporte'],['mercado','Mercado','Alimentação'],
];
const normalize = value => String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const units={zero:0,um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12,treze:13,quatorze:14,catorze:14,quinze:15,dezesseis:16,dezessete:17,dezoito:18,dezenove:19};
const tens={vinte:20,trinta:30,quarenta:40,cinquenta:50,sessenta:60,setenta:70,oitenta:80,noventa:90};
const hundreds={cem:100,cento:100,duzentos:200,trezentos:300,quatrocentos:400,quinhentos:500,seiscentos:600,setecentos:700,oitocentos:800,novecentos:900};
const spokenWords = Object.keys({...units,...tens,...hundreds});
const wordsOrAnd = [...spokenWords,'mil','e'];
function spokenNumber(raw) {
 const words=normalize(raw).split(/\s+/).filter(x=>x!=='e');
 if(!words.length)return null;
 let total=0,group=0,any=false;
 for(const word of words){
  if(word==='mil'){total+=(group||1)*1000;group=0;any=true;continue;}
  const n=units[word]??tens[word]??hundreds[word];
  if(n===undefined)return null;
  group+=n;any=true;
 }
 const value=total+group;
 return any && value>0 && value<=10_000_000 ? value*100 : null;
}
function numericAmount(raw){
 const cleaned=raw.replace(/^r\$\s*/i,'').trim();
 const normalized=cleaned.includes(',')?cleaned.replace(/\./g,'').replace(',','.'):/^\d{1,3}(?:\.\d{3})+$/.test(cleaned)?cleaned.replace(/\./g,''):cleaned;
 if(!/^\d+(?:\.\d{1,2})?$/.test(normalized))return null;
 const [whole,fraction='']=normalized.split('.');
 const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 return Number.isSafeInteger(cents)&&cents>0&&cents<=1_000_000_000?cents:null;
}
/** Recognizes numbers in BRL, including 3.900,50 and "três mil e novecentos reais". */
function amounts(text){
 const spans=[];
 const numeral=/(?:r\$\s*)?(?:\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:reais?\b)?/g;
 let match;
 while((match=numeral.exec(text))){
  const raw=match[0].replace(/\s*reais?\b$/,'').trim();
  const cents=numericAmount(raw);
  if(cents!==null)spans.push({start:match.index,end:numeral.lastIndex,cents});
 }
 const words='(?:'+wordsOrAnd.join('|')+')';
 const spoken=new RegExp('\\b('+words+'(?:\\s+'+words+')*)\\s+reais?\\b','g');
 while((match=spoken.exec(text))){
  const cents=spokenNumber(match[1]);
  if(cents!==null&&!spans.some(s=>match.index<s.end&&spoken.lastIndex>s.start))spans.push({start:match.index,end:spoken.lastIndex,cents});
 }
 // "cem de água" or "cinquenta de luz" is common in spoken shorthand.
 const short=new RegExp('\\b('+words+'(?:\\s+'+words+')*)\\s+(?=de\\s|da\\s|do\\s)','g');
 while((match=short.exec(text))){
  const cents=spokenNumber(match[1]);
  if(cents!==null&&!spans.some(s=>match.index<s.end&&short.lastIndex>s.start))spans.push({start:match.index,end:match.index+match[1].length,cents});
 }
 return spans.sort((a,b)=>a.start-b.start);
}
const transition=/\s+e\s+(?=(?:recebi|ganhei|gastei|paguei|comprei|entrou|salario|vendi|tenho|preciso|falta|vou|devo|a\s+pagar|a\s+receber|vence|vencera|ainda)\b)/;
function firstClause(s){const first=s.split(transition)[0].split(/\s+(?=(?:recebi|ganhei|gastei|paguei|comprei|entrou|depositaram|tenho|preciso|falta|vou|devo|vence|vencera|ainda)\b)/)[0].split(/[,;.!?\n]/)[0].trim();return /^(?:e|de|da|do)$/.test(first)?'':first;}
function lastClause(s){return s.split(/[,;.!?\n]/).at(-1).split(transition).at(-1).trim();}
function category(s){
 const t=normalize(s);
 for(const [cat,terms] of categories)if(terms.some(term=>new RegExp('\\b'+term).test(t)))return cat;
 return 'Outros';
}
function label(s,kind){
 const n=normalize(s);
 for(const [term,name,cat] of quickLabels){if(new RegExp('\\b'+term+'\\b').test(n)&&(kind==='income'||cat!=='Entradas'))return {title:name,category:kind==='income'?'Entradas':cat};}
 const cleaned=s.replace(/\b(recebi|ganhei|gastei|paguei|comprei|entrou|salario|vendi|tenho|preciso|pagar|receber|falta|devo|vou|vai|vence|vencera|pago|pendente|reais|real|r\$|de|do|da|para|em|na|no|pelo|pela|e|ontem|hoje|foi|conta|um|uma)\b/g,' ').replace(/\s+/g,' ').trim();
 return {title:(cleaned|| (kind==='income'?'Entrada extra':'Gasto registrado')).slice(0,160),category:kind==='income'?'Entradas':category(s)};
}
/**
 * Separate direction (income/expense) from settlement (settled/pending).
 * Explicit financial verbs outrank nouns like "salário". When time is unspecified,
 * treat expenses and expected salary conservatively as pending instead of inventing
 * that money has moved. A preceding verb may govern a comma-delimited series.
 */
const actions = [
  {re:/\b(?:tenho\s+(?:que|de)\s+receber|preciso\s+receber|vou\s+receber|ainda\s+(?:vou\s+)?receber|falta\s+receber|a\s+receber|irei\s+receber|receberei|vai\s+cair|deve\s+entrar)\b/g,kind:'income',status:'pending'},
  {re:/\b(?:tenho\s+(?:que|de)\s+pagar|preciso\s+pagar|vou\s+pagar|ainda\s+(?:vou\s+)?pagar|falta\s+pagar|a\s+pagar|irei\s+pagar|pagarei|devo\s+pagar|tenho\s+uma?\s+conta\s+de|vence|vencera|esta\s+pendente)\b/g,kind:'expense',status:'pending'},
  {re:/\b(?:ja\s+recebi|recebi|ganhei|depositaram|entrou|caiu|vendi|pix\s+recebido|foi\s+creditado)\b/g,kind:'income',status:'settled'},
  {re:/\b(?:ja\s+paguei|paguei|gastei|comprei|quite[ie]|foi\s+pago|debitaram|descontaram|saiu\s+da\s+conta)\b/g,kind:'expense',status:'settled'}
];
function detectAction(segment){
 let chosen=null;
 for(const action of actions){action.re.lastIndex=0;let found;while((found=action.re.exec(segment))!==null){if(!chosen || found.index>=chosen.index)chosen={index:found.index,kind:action.kind,status:action.status};}}
 return chosen;
}
function resolveMovement(prefix,picked,previous){
 // Locate the last explicit action BEFORE this amount, or use prior series action.
 const action=detectAction(prefix);
 if(action)return {kind:action.kind,status:action.status};
 if(/\b(?:salario|renda|recebimento)\b/.test(prefix))return {kind:'income',status:'pending'};
 const linked=detectAction(picked);
 if(linked)return {kind:linked.kind,status:linked.status};
 if(/\b(?:salario|recebimento|renda|pagamento\s+recebido)\b/.test(picked))return {kind:'income',status:'pending'};
 if(previous){
  if(previous.kind==='income' && category(picked)!=='Outros')return {kind:'expense',status:'pending'};
  return {...previous};
 }
 return {kind:'expense',status:'pending'};
}
function dateOf(s,today){let date=today||todayBrazil();if(/\bontem\b/.test(s)){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);date=d.toISOString().slice(0,10);}else if(/\bamanha\b/.test(s)){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);date=d.toISOString().slice(0,10);}return date;}
/**
 * Returns {items, error:null} or {items:[],error}.
 * Limit 12 items/utterance to control WhatsApp reply size, mishearings and spend.
 */
function interpretFinanceBatch(message,today){
 const text=normalize(message);
 if(!text||text.length>1500)return {items:[],error:'Envie uma mensagem de até 1.500 caracteres.'};
 const found=amounts(text);
 if(!found.length)return {items:[],error:'Não identifiquei valores. Diga, por exemplo: 100 de água, 100 de luz e recebi 3900 de salário.'};
 if(found.length>12)return {items:[],error:'Encontrei mais de 12 valores. Divida em áudios menores.'};
 const items=[];
 for(let i=0;i<found.length;i++){
  const current=found[i];
  const prev=found[i-1],next=found[i+1];
  const left=lastClause(text.slice(prev?.end??0,current.start));
  const rawRight=text.slice(current.end,next?.start??text.length);
  const right=firstClause(rawRight);
  const leftTag=category(left),rightTag=category(right);
  const rightIsLinked=/^(?:de|da|do|para|na|no|em)\b/.test(right);
  const actionPrefix=lastClause(text.slice(prev?.end??0,current.start));
  const movement=resolveMovement(actionPrefix,category(actionPrefix)!=='Outros'?actionPrefix:right,items.at(-1)?{kind:items.at(-1).kind,status:items.at(-1).status}:null);
  const leftIsIncome=movement.kind==='income';
  const previousChosen=items[i-1];
  const leftLooksPrev=previousChosen&&leftTag!=='Outros'&&leftTag===previousChosen.category&&lastClause(text.slice(found[i-1].end,current.start))===previousChosen._picked;
  let picked;
  if(/\b(?:salario|renda)\b/.test(left)&&!detectAction(left))picked=left;
  else if(leftIsIncome&&/\b(salario|pagamento|venda)\b/.test(right))picked=right;
  else if(rightIsLinked&&right.length>2)picked=right;
  else if(leftLooksPrev&&right)picked=right;
  else if(left&&leftTag!=='Outros')picked=left;
  else if(right)picked=right;
  else picked=left;
  // If the last verb before the money is income, do not inherit the previous expense.
  // New explicit action after the previous amount must override inherited direction.
  const kind=movement.kind;
  const status=movement.status;
  if(!picked||/^\s*(?:de|da|do|e)\s*$/.test(picked))return {items:[],error:`Encontrei ${found.length} valores, mas faltou a descrição de um deles. Informe nome e valor de cada conta.`};
  // Prevent implicit allocation of one price to multiple named bills.
  if(found.length===1&&/\b(?:agua|luz|internet|aluguel)\b.*\be\s+(?:agua|luz|internet|aluguel)\b/.test(picked))return {items:[],error:'Você citou mais de uma conta com um único valor. Diga o preço de cada uma separadamente.'};
  const meta=label(picked,kind);
  items.push({kind,status,cents:current.cents,category:meta.category,title:meta.title,date:dateOf(left+' '+right,today),_picked:picked});
 }
 return {items:items.map(({_picked,...item})=>item),error:null};
}
/** Backward-compatible single-expense API for existing integrations. */
function interpretFinance(message,today){
 const result=interpretFinanceBatch(message,today);
 return result.error||result.items.length!==1?null:result.items[0];
}
function brl(cents){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);}
function todayBrazil(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}

root.BolsoBatch={interpretFinanceBatch,todayBrazil,normalize,brl};
})(window);
