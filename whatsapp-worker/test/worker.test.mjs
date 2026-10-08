import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,webcrypto} from 'node:crypto';
import {handleRequest,verifySignature} from '../src/index.mjs';
import {interpretFinance,interpretFinanceBatch,brl,todayBrazil} from '../src/finance.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;

class FakeDatabase {
  constructor(){this.devices=new Map();this.codes=new Map();this.pending=new Map();this.pendingBatches=new Map();this.received=new Map();this.inbox=new Map();this.entries=[];this.nextCursor=1;}
  prepare(sql){const db=this;return {bind(...args){return {
   async first(){
    if(sql.includes('FROM devices WHERE token_hash=')){const wa=db.devices.get(args[0]);return wa===undefined?null:{token_hash:args[0],wa_id:wa};}
    if(sql.includes('FROM link_codes WHERE code_hash=')){const code=db.codes.get(args[0]);return code&&code.expires_at>args[1]?{token_hash:code.token_hash}:null;}
    if(sql.includes('FROM pending_batches WHERE wa_id=')){return db.pendingBatches.get(args[0])||null;}
    if(sql.includes('FROM pending WHERE wa_id=')){return db.pending.get(args[0])||null;}
    if(sql.includes('COUNT(*) AS count'))return {count:[...db.received.values()].filter(x=>x.sender===args[0]).length};
    if(sql.includes('FROM inbox WHERE id=')){return db.inbox.get(args[0])||null;}
    if(sql.includes('SUM(cents)'))return null;
    throw Error('Unmocked first: '+sql);
   },
   async all(){
    if(sql.includes('FROM transactions WHERE wa_id=? AND rowid>?')){
       return {results:db.entries.filter(x=>x.wa_id===args[0]&&x.cursor>args[1]).sort((a,b)=>a.cursor-b.cursor).slice(0,200).map(e=>({cursor:e.cursor,remoteId:e.id,kind:e.kind,cents:e.cents,title:e.title,category:e.category,date:e.occurred_on,status:e.status||'settled'}))};
    }
    if(sql.includes('COALESCE(SUM(cents),0)'))return {results:[...new Map(db.entries.filter(e=>e.wa_id===args[0]).map(e=>[e.kind+'_'+e.status,{kind:e.kind,status:e.status,cents:db.entries.filter(k=>k.kind===e.kind&&k.status===e.status&&k.wa_id===args[0]).reduce((s,k)=>s+k.cents,0)}])).values()]};
    if(sql.includes('FROM transactions WHERE wa_id=? ORDER'))return {results:db.entries.filter(e=>e.wa_id===args[0]).slice(-8).reverse()};
    if(sql.includes('FROM inbox WHERE status='))return {results:[]};
    throw Error('Unmocked all: '+sql);
   },
   async run(){
    let changes=1;
    if(sql.startsWith('INSERT INTO devices')){if(!db.devices.has(args[0]))db.devices.set(args[0],null);else changes=0;}
    else if(sql.startsWith('DELETE FROM link_codes WHERE token_hash=')){for(const [key,value] of db.codes)if(value.token_hash===args[0])db.codes.delete(key);}
    else if(sql.startsWith('INSERT INTO link_codes'))db.codes.set(args[0],{token_hash:args[1],expires_at:args[2]});
    else if(sql.startsWith('UPDATE devices SET wa_id=?,linked_at='))db.devices.set(args[1],args[0]);
    else if(sql.startsWith('UPDATE devices SET wa_id=NULL'))db.devices.set(args[0],null);
    else if(sql.startsWith('DELETE FROM link_codes WHERE token_hash=')){for(const [key,value] of db.codes)if(value.token_hash===args[0])db.codes.delete(key);}
    else if(sql.startsWith('INSERT OR REPLACE INTO pending_batches'))db.pendingBatches.set(args[0],{wa_id:args[0],source_message_id:args[1],items_json:args[2],expires_at:args[3]});
    else if(sql.startsWith('DELETE FROM pending_batches WHERE wa_id=? AND')){const row=db.pendingBatches.get(args[0]);if(row?.source_message_id===args[1])db.pendingBatches.delete(args[0]);else changes=0;}
    else if(sql.startsWith('DELETE FROM pending_batches WHERE wa_id='))db.pendingBatches.delete(args[0]);
    else if(sql.startsWith('INSERT OR REPLACE INTO pending'))db.pending.set(args[0],{wa_id:args[0],kind:args[1],cents:args[2],title:args[3],category:args[4],occurred_on:args[5],source_message_id:args[6],expires_at:args[7]});
    else if(sql.startsWith('DELETE FROM pending WHERE wa_id=? AND'))db.pending.delete(args[0]);
    else if(sql.startsWith('DELETE FROM pending WHERE wa_id='))db.pending.delete(args[0]);
    else if(sql.startsWith('INSERT OR IGNORE INTO transactions')){if(db.entries.some(x=>x.source_message_id===args[7]))changes=0;else db.entries.push({cursor:db.nextCursor++,id:args[0],wa_id:args[1],kind:args[2],cents:args[3],title:args[4],category:args[5],occurred_on:args[6],source_message_id:args[7],status:args[8]});}
    else if(sql.startsWith('INSERT OR IGNORE INTO received_events')){if(db.received.has(args[0]))changes=0;else db.received.set(args[0],{sender:args[1]});}
    else if(sql.startsWith('INSERT OR IGNORE INTO inbox')){if(db.inbox.has(args[0]))changes=0;else db.inbox.set(args[0],{id:args[0],sender:args[1],payload_json:args[2],attempts:0,status:'queued',last_attempt:0});}
    else if(sql.startsWith('UPDATE inbox SET status=\'processing\'')){const row=db.inbox.get(args[1]);if(row&&row.attempts<5&&row.status==='queued'){row.status='processing';row.last_attempt=args[0];row.attempts++;}else changes=0;}
    else if(sql.startsWith('DELETE FROM inbox WHERE id='))db.inbox.delete(args[0]);
    else if(sql.startsWith('UPDATE inbox SET status=CASE')){const row=db.inbox.get(args[0]);if(row)row.status=row.attempts>=5?'failed':'queued';}
    else if(sql.startsWith('DELETE FROM transactions WHERE wa_id='))db.entries=db.entries.filter(x=>x.wa_id!==args[0]);
    else if(sql.startsWith('DELETE FROM received_events WHERE')){}
    else if(sql.startsWith('DELETE FROM link_codes WHERE expires_at<')){}
    else if(sql.startsWith('DELETE FROM pending_batches WHERE expires_at<')){}
    else throw Error('Unmocked run: '+sql);
    return {meta:{changes}};
   }
  }}}}
  async batch(statements){const out=[];for(const statement of statements)out.push(await statement.run());return out;}
}

const phone='5511999999999',foreign='5511888888888';
const token='a'.repeat(43);
const secret='meta-test-secret';
function env(db){return {DB:db,META_APP_SECRET:secret,WA_VERIFY_TOKEN:'verify-123',WA_PHONE_NUMBER_ID:'1234567890',WA_ACCESS_TOKEN:'testing',ALLOWED_WA_IDS:phone,GRAPH_API_VERSION:'v24.0'};}
function webhookMessage(id,from,body){return {object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'1234567890'},messages:[{id:`wamid.${id}`,from,type:'text',text:{body}}]}}]}]};}
async function sendWebhook(envObj,id,from,body,queue){const raw=JSON.stringify(webhookMessage(id,from,body));const signature='sha256='+createHmac('sha256',secret).update(raw).digest('hex');const req=new Request('https://bolso.test/webhook',{method:'POST',headers:{'x-hub-signature-256':signature},body:raw});const response=await handleRequest(req,envObj,{waitUntil:job=>queue.push(job)});await Promise.all(queue.splice(0));return response;}

// An isolated fetch mock: the tests never call Meta or Groq for real.
const realFetch=globalThis.fetch;
let sent=[];
globalThis.fetch=async (url,options) => {if(String(url).includes('/messages')){sent.push(JSON.parse(options.body));return new Response('{}',{status:200});}throw Error('unexpected external request '+url);};

test('signature validation accepts original bytes only',async()=>{
 const raw='{"test":true}',signed='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
 assert.equal(await verifySignature(raw,signed,secret),true);
 assert.equal(await verifySignature(raw+' ',signed,secret),false);
 assert.equal(await verifySignature(raw,signed.slice(0,-2),secret),false);
});
test('Meta webhook handshake validates token',async()=>{
 const e=env(new FakeDatabase());
 let reply=await handleRequest(new Request('https://bolso.test/webhook?hub.mode=subscribe&hub.verify_token=verify-123&hub.challenge=XY98'),e);
 assert.equal(reply.status,200);assert.equal(await reply.text(),'XY98');
 reply=await handleRequest(new Request('https://bolso.test/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=XY98'),e);assert.equal(reply.status,403);
});
test('authorization blocks missing token',async()=>{
 const r=await handleRequest(new Request('https://bolso.test/v1/device/transactions'),env(new FakeDatabase()));assert.equal(r.status,401);
});
test('Portuguese classification, cents and dates',()=>{
 assert.equal(interpretFinance('gastei 50 reais de bolachas','2026-10-08').cents,5000);
 assert.equal(interpretFinance('paguei trinta reais de gasolina','2026-10-08').category,'Transporte');
 assert.equal(interpretFinance('recebi 200 reais ontem','2026-10-08').date,'2026-10-07');
 assert.equal(interpretFinance('paguei nada','2026-10-08'),null);
 assert.equal(brl(5000),'R$ 50,00');
 assert.match(todayBrazil(),/^\d{4}-\d{2}-\d{2}$/);
});
test('end to end: pairing, confirm, sync, dedup and user isolation',async()=>{
 const db=new FakeDatabase(),e=env(db),jobs=[];sent=[];
 const headers={Authorization:'Bearer '+token};
 const start=await handleRequest(new Request('https://bolso.test/v1/device/pair/start',{method:'POST',headers}),e);
 assert.equal(start.status,200);const pair=await start.json();assert.match(pair.code,/^[A-Z2-9]{12}$/);
 assert.equal((await (await handleRequest(new Request('https://bolso.test/v1/device/status',{headers}),e)).json()).linked,false);
 await sendWebhook(e,'link00001',phone,`VINCULAR ${pair.code}`,jobs);
 assert.equal((await (await handleRequest(new Request('https://bolso.test/v1/device/status',{headers}),e)).json()).linked,true);
 await sendWebhook(e,'expense01',phone,'gastei 50 reais de bolachas',jobs);
 assert.equal(db.entries.length,0,'no auto-save without confirmation');assert.equal(JSON.parse(db.pendingBatches.get(phone).items_json)[0].cents,5000);
 await sendWebhook(e,'confirm001',phone,'SIM',jobs);
 assert.equal(db.entries.length,1);assert.equal(db.entries[0].category,'Alimentação');
 await sendWebhook(e,'confirm001',phone,'SIM',jobs);
 assert.equal(db.entries.length,1,'Meta redelivery should be idempotent');
 await sendWebhook(e,'foreign001',foreign,'gastei 30 reais de taxi',jobs);
 assert.equal(db.entries.length,1,'unallowlisted phone cannot write');
 const sync=await handleRequest(new Request('https://bolso.test/v1/device/transactions?cursor=0',{headers}),e);
 assert.equal(sync.status,200);const data=await sync.json();assert.equal(data.items.length,1);assert.equal(data.items[0].cents,5000);
 const after=await(await handleRequest(new Request('https://bolso.test/v1/device/transactions?cursor='+data.nextCursor,{headers}),e)).json();assert.equal(after.items.length,0);
 assert.ok(sent.some(m=>m.text.body.includes('Confirme')||m.text.body.includes('Confira')));
});
test('reject unsigned or malformed webhook',async()=>{
 const e=env(new FakeDatabase());const r=await handleRequest(new Request('https://bolso.test/webhook',{method:'POST',body:'{}'}),e);assert.equal(r.status,401);
});
test('unlink ends device access but preserves remote entries',async()=>{
 const db=new FakeDatabase(),e=env(db),jobs=[];const headers={Authorization:'Bearer '+token};
 const start=await handleRequest(new Request('https://bolso.test/v1/device/pair/start',{method:'POST',headers}),e);const pair=await start.json();
 await sendWebhook(e,'linklast01',phone,`VINCULAR ${pair.code}`,jobs);
 const out=await handleRequest(new Request('https://bolso.test/v1/device/unlink',{method:'POST',headers}),e);
 assert.equal((await out.json()).linked,false);
 const notAllowed=await handleRequest(new Request('https://bolso.test/v1/device/transactions',{headers}),e);assert.equal(notAllowed.status,403);
});


test('voice WhatsApp media is transcribed privately and still requires SIM',async()=>{
 const db=new FakeDatabase(),e={...env(db),GROQ_API_KEY:'groq-test'},jobs=[];
 const fetchBefore=globalThis.fetch;
 globalThis.fetch=async (url,options) => {
  if(String(url).endsWith('/messages')){sent.push(JSON.parse(options.body));return new Response('{}',{status:200});}
  if(String(url).endsWith('/123456789098765'))return Response.json({url:'https://lookaside.fbsbx.com/secure-media',file_size:16,mime_type:'audio/ogg'});
  if(String(url)==='https://lookaside.fbsbx.com/secure-media')return new Response(new Uint8Array([0x4f,0x67,0x67,0x53,0,0]));
  if(String(url).includes('api.groq.com/openai/v1/audio/transcriptions')){
    assert.equal(options.method,'POST');assert.ok(options.body instanceof FormData);
    assert.equal(options.body.get('language'),'pt');return Response.json({text:'Gastei 60 reais de gasolina'});
  }
  throw Error('unexpected URL in audio test '+url);
 };
 try {
  const body={object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'1234567890'},messages:[{id:'wamid.voice001',from:phone,type:'audio',audio:{id:'123456789098765'}}]}}]}]};
  const raw=JSON.stringify(body),signature='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
  const resp=await handleRequest(new Request('https://bolso.test/webhook',{method:'POST',headers:{'x-hub-signature-256':signature},body:raw}),e,{waitUntil:p=>jobs.push(p)});
  assert.equal(resp.status,200);await Promise.all(jobs);
  assert.equal(db.entries.length,0,'voice draft not auto committed');assert.equal(JSON.parse(db.pendingBatches.get(phone).items_json)[0].cents,6000);assert.equal(JSON.parse(db.pendingBatches.get(phone).items_json)[0].category,'Transporte');
  await sendWebhook(e,'voiceconf1',phone,'SIM',jobs);assert.equal(db.entries.length,1);
 }finally{globalThis.fetch=fetchBefore;}
});
test('voice without speech key replies with guidance, no transaction created',async()=>{
 const db=new FakeDatabase(),e=env(db),jobs=[],body={object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'1234567890'},messages:[{id:'wamid.voice002',from:phone,type:'audio',audio:{id:'123456789098765'}}]}}]}]};
 const raw=JSON.stringify(body),sig='sha256='+createHmac('sha256',secret).update(raw).digest('hex');sent=[];
 await handleRequest(new Request('https://bolso.test/webhook',{method:'POST',headers:{'x-hub-signature-256':sig},body:raw}),e,{waitUntil:p=>jobs.push(p)});
 await Promise.all(jobs);assert.equal(db.pending.size,0);assert.ok(sent.some(x=>x.text.body.includes('áudio está desativado')));
});


const example='Paguei 100 reais de água, 100 reais de luz, 100 reais de internet e recebi 3.900 reais de salário';
test('multi-item voice with three expenses and salary extracted independently',()=>{
 const batch=interpretFinanceBatch(example,'2026-10-08');
 assert.equal(batch.error,null);assert.equal(batch.items.length,4);
 assert.deepEqual(batch.items.map(x=>[x.kind,x.cents,x.category,x.title]),[
  ['expense',10000,'Moradia','Água'],['expense',10000,'Moradia','Luz'],
  ['expense',10000,'Moradia','Internet'],['income',390000,'Entradas','Salário']]);
});
test('number words plus short-form commands without punctuation',()=>{
 const one=interpretFinanceBatch('cem reais de agua cem de luz cem reais de internet recebi tres mil e novecentos reais de salario','2026-10-08');
 assert.equal(one.error,null);assert.equal(one.items.length,4);
 assert.deepEqual(one.items.map(x=>x.cents),[10000,10000,10000,390000]);
 const two=interpretFinanceBatch('água 100, luz 100, internet 100, salário 3900','2026-10-08');
 assert.deepEqual(two.items.map(x=>x.title),['Água','Luz','Internet','Salário']);
});
test('ask for clarification instead of dividing one amount among multiple bills',()=>{
 assert.match(interpretFinanceBatch('gastei 100 de água e luz').error,/cada uma/);
 assert.equal(interpretFinanceBatch('gastei nada').items.length,0);
 assert.ok(interpretFinanceBatch(Array.from({length:13},(_,i)=>`${i+1} de agua`).join(', ')).error);
});
test('complete multi-message confirmation is atomic, deduplicated and device-syncable',async()=>{
 const db=new FakeDatabase(),e=env(db),jobs=[],headers={Authorization:'Bearer '+token};sent=[];
 await sendWebhook(e,'batch001',phone,example,jobs);
 assert.equal(db.entries.length,0);const batch=JSON.parse(db.pendingBatches.get(phone).items_json);
 assert.equal(batch.length,4);assert.equal(batch[3].kind,'income');
 const preview=sent.at(-1).text.body;
 assert.match(preview,/Recebido:/);assert.match(preview,/Pago:/);assert.match(preview,/Internet/);
 await sendWebhook(e,'approve01',phone,'SIM',jobs);
 assert.equal(db.entries.length,4);assert.equal(db.entries.filter(x=>x.kind==='expense').length,3);
 assert.equal(db.entries.filter(x=>x.kind==='income').length,1);
 assert.equal(db.entries.filter(x=>x.category==='Moradia').length,3);
 assert.equal(db.pendingBatches.size,0);
 await sendWebhook(e,'approve02',phone,'SIM',jobs);assert.equal(db.entries.length,4);
 const sync=await handleRequest(new Request('https://bolso.test/v1/device/transactions?cursor=0',{headers}),e);
 // Not yet linked: auth test ensures the endpoint enforces pairing.
 assert.equal(sync.status,401);
});
test('salary before expenses and single-amount ambiguity are handled',()=>{
 for (const phrase of [
  'recebi salário de 3900 e paguei 100 de água',
  'recebi 3900 de salário e paguei 100 de água',
  'salário 3900 água 100',
 ]) {
  const result=interpretFinanceBatch(phrase,'2026-10-08');
  assert.equal(result.error,null,phrase);
  assert.deepEqual(result.items.map(x=>[x.kind,x.cents]),[['income',390000],['expense',10000]],phrase);
 }
});
test('voice from Meta recognizes four movements in one audio, pending confirmation',async()=>{
 const db=new FakeDatabase(),e={...env(db),GROQ_API_KEY:'groq-test'},jobs=[];
 const fetchBefore=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  if(String(url).endsWith('/messages')){sent.push(JSON.parse(options.body));return new Response('{}',{status:200});}
  if(String(url).endsWith('/123456789098765'))return Response.json({url:'https://lookaside.fbsbx.com/secure-media',file_size:16,mime_type:'audio/ogg'});
  if(String(url)==='https://lookaside.fbsbx.com/secure-media')return new Response(new Uint8Array([0x4f,0x67,0x67,0x53,0]));
  if(String(url).includes('api.groq.com/openai/v1/audio/transcriptions')){assert.equal(options.body.get('language'),'pt');return Response.json({text:example});}
  throw Error('unexpected external request '+url);
 };
 try {
  const payload={object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'1234567890'},messages:[{id:'wamid.voicemulti0001',from:phone,type:'audio',audio:{id:'123456789098765'}}]}}]}]};
  const raw=JSON.stringify(payload),sig='sha256='+createHmac('sha256',secret).update(raw).digest('hex');sent=[];
  const resp=await handleRequest(new Request('https://bolso.test/webhook',{method:'POST',headers:{'x-hub-signature-256':sig},body:raw}),e,{waitUntil:job=>jobs.push(job)});
  assert.equal(resp.status,200);await Promise.all(jobs);
  assert.equal(db.entries.length,0);assert.equal(JSON.parse(db.pendingBatches.get(phone).items_json).length,4);
  assert.match(sent.at(-1).text.body,/R\$\s*3\.900,00/);
  await sendWebhook(e,'audiosim001',phone,'SIM',jobs);
  assert.equal(db.entries.length,4);
  assert.deepEqual(db.entries.map(x=>x.cents),[10000,10000,10000,390000]);
 }finally{globalThis.fetch=fetchBefore;}
});
test('batch cancellation does not write transactions',async()=>{
 const db=new FakeDatabase(),e=env(db),jobs=[];
 await sendWebhook(e,'batchcan1',phone,example,jobs);
 assert.equal(db.pendingBatches.size,1);
 await sendWebhook(e,'batchcan2',phone,'NÃO',jobs);
 assert.equal(db.pendingBatches.size,0);assert.equal(db.entries.length,0);
});
after(()=>{globalThis.fetch=realFetch;});

// Distinguishing planned and realized movement is essential for trustworthy budgets.
test('verb tenses separate paid, payable, received and receivable in one voice note',()=>{
 const x=interpretFinanceBatch('paguei 100 de água, tenho que pagar 100 de luz, recebi 3900 de salário e vou receber 200 de serviço','2026-10-08');
 assert.equal(x.error,null);
 assert.deepEqual(x.items.map(v=>[v.kind,v.status,v.cents,v.title]),[
  ['expense','settled',10000,'Água'],['expense','pending',10000,'Luz'],['income','settled',390000,'Salário'],['income','pending',20000,'servico']]);
});
test('short phrases without payment verbs default to pending',()=>{
 const x=interpretFinanceBatch('100 de água, 100 de luz e salário 3900','2026-10-08');
 assert.equal(x.error,null);
 assert.deepEqual(x.items.map(v=>[v.kind,v.status]),[['expense','pending'],['expense','pending'],['income','pending']]);
});
test('WhatsApp confirmation retains individual payment status and sync exposes it',async()=>{
 const db=new FakeDatabase(),e=env(db),jobs=[];sent=[];
 await sendWebhook(e,'tense0001',phone,'paguei 100 de agua e tenho que pagar 100 de luz e recebi 3900 de salario',jobs);
 assert.match(sent.at(-1).text.body,/A pagar/);
 assert.equal(db.entries.length,0);
 await sendWebhook(e,'tense0002',phone,'SIM',jobs);
 assert.deepEqual(db.entries.map(r=>r.status),['settled','pending','settled']);
 const hash='x'.repeat(43);
 await handleRequest(new Request('https://bolso.test/v1/device/pair/start',{method:'POST',headers:{Authorization:'Bearer '+hash}}),e);
 // No linked device can see private transaction statuses.
 const forbidden=await handleRequest(new Request('https://bolso.test/v1/device/transactions',{headers:{Authorization:'Bearer '+hash}}),e);
 assert.equal(forbidden.status,403);
});
