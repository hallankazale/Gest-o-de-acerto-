/** Deterministic Portuguese finance command interpreter: no LLM, low cost, auditable. */
const categories = [
  ['Alimentação', ['bolacha','biscoito','salgadinho','mercado','supermercado','comida','lanche','pizza','pao','padaria','acougue','arroz','feijao','leite','almoco','jantar','restaurante','cafe','delivery','ifood','fruta']],
  ['Transporte', ['uber','gasolina','etanol','diesel','combustivel','posto','onibus','taxi','moto','pedagio','estacionamento']],
  ['Moradia', ['aluguel','agua','luz','energia','internet','condominio','gas de cozinha']],
  ['Pensões',['pensao','pension']],
  ['Saúde',['farmacia','remedio','dentista','medico','consulta','academia','exame']],
  ['Compras',['roupa','sapato','movel','moveis','loja','celular','eletrodomestico','presente']],
  ['Lazer',['cinema','jogo','passeio','show','viagem','parque','festa']],
];
export const normalize = value => String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const unit = {um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12,treze:13,quatorze:14,catorze:14,quinze:15,dezesseis:16,dezessete:17,dezoito:18,dezenove:19,vinte:20,trinta:30,quarenta:40,cinquenta:50,sessenta:60,setenta:70,oitenta:80,noventa:90,cem:100,cento:100,duzentos:200,trezentos:300,quatrocentos:400,quinhentos:500,seiscentos:600,setecentos:700,oitocentos:800,novecentos:900};
function wordsToCents(value){
 const found=normalize(value).match(/((?:[a-z]+\s+){1,9})(?:reais?|r\$)\b/);if(!found)return null;
 const words=found[1].trim().split(/\s+/);let number=0,had=false;
 for(let i=words.length-1;i>=0;i--){if(words[i]==='e'&&had)continue;if(unit[words[i]]!==undefined){had=true;number+=unit[words[i]];}else if(had)break;}
 return number>0 && number<=1000?number*100:null;
}
export function interpretFinance(message, today){
 const phrase=String(message??'').trim();if(!phrase||phrase.length>300)return null;
 const clean=normalize(phrase);
 const found=clean.match(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:reais?)?\b/);
 let cents=null;
 if(found){const raw=found[1];const normalized=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'): /^\d{1,3}(?:\.\d{3})+$/.test(raw)?raw.replace(/\./g,''):raw;
   const [whole,decimal='']=normalized.split('.');cents=Number(whole)*100+Number(decimal.padEnd(2,'0'));}
 if(cents==null)cents=wordsToCents(phrase);
 if(!Number.isSafeInteger(cents)||cents<1||cents>1_000_000_000)return null;
 const kind=/\b(recebi|ganhei|entrou|depositaram|recebimento|salario|vendi)\b/.test(clean)?'income':'expense';
 const category=kind==='income'?'Entradas':(categories.find(([_,terms])=>terms.some(term=>clean.includes(term)))||['Outros'])[0];
 let title=phrase.replace(/\b(?:r\$\s*)?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b|\b(?:r\$\s*)?\d+(?:[.,]\d{1,2})?\b/gi,'')
 .replace(/\b(gastei|paguei|comprei|recebi|ganhei|entrou|depositaram|vendi|reais|real|r\$|com|em|de|do|da|por|no|na|hoje|ontem)\b/gi,' ').replace(/\s+/g,' ').trim();
 if(title.length<2)title=kind==='income'?'Entrada extra':'Gasto registrado';
 let date=today||new Date().toISOString().slice(0,10);if(/\bontem\b/.test(clean)){const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()-1);date=d.toISOString().slice(0,10);}
 return {kind,cents,category,title:title.slice(0,160),date};
}
export function brl(cents){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);}
export function todayBrazil(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
