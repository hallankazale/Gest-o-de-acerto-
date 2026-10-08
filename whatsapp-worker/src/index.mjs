import {interpretFinance,brl,todayBrazil,normalize} from './finance.mjs';

const json = (value, code=200) => new Response(JSON.stringify(value),{status:code,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const plain = (value,code=200) => new Response(value,{status:code,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
const nowSeconds = () => Math.floor(Date.now()/1000);
const safeId = value => /^\d{8,18}$/.test(String(value??''));
const graphVersion = env => /^v\d+\.\d+$/.test(env.GRAPH_API_VERSION||'') ? env.GRAPH_API_VERSION : 'v24.0';
const allowedSender = (phone,env) => safeId(phone) && (env.ALLOWED_WA_IDS||'').split(',').map(s=>s.trim()).filter(Boolean).includes(phone);
async function sha256(input){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');}
function equalBytes(a,b){if(a.byteLength!==b.byteLength)return false;const x=new Uint8Array(a),y=new Uint8Array(b);let unequal=0;for(let i=0;i<x.length;i++)unequal|=x[i]^y[i];return unequal===0;}
export async function verifySignature(raw, header, secret){
  if(!secret || !/^sha256=[a-f0-9]{64}$/i.test(header||''))return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const calculated=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw));
  const hex=header.slice(7);const claimed=Uint8Array.from(hex.match(/../g),pair=>parseInt(pair,16));
  return equalBytes(calculated,claimed.buffer);
}
function randomCode(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=crypto.getRandomValues(new Uint8Array(12));return [...bytes].map(x=>alphabet[x%alphabet.length]).join('');}
async function bearerHash(request){const match=(request.headers.get('Authorization')||'').match(/^Bearer\s+([A-Za-z0-9_-]{32,128})$/);return match?sha256(match[1]):null;}
async function device(request,env){const hash=await bearerHash(request);if(!hash)return null;const row=await env.DB.prepare('SELECT token_hash,wa_id FROM devices WHERE token_hash=?').bind(hash).first();return row||null;}
async function handleDevice(request,env,url){
 const path=url.pathname;
 if(path==='/v1/device/pair/start'&&request.method==='POST'){
  const hash=await bearerHash(request);if(!hash)return json({error:'Credencial de dispositivo inválida'},401);
  await env.DB.prepare('INSERT INTO devices(token_hash) VALUES(?) ON CONFLICT(token_hash) DO NOTHING').bind(hash).run();
  const old=await env.DB.prepare('SELECT wa_id FROM devices WHERE token_hash=?').bind(hash).first();
  if(old?.wa_id)return json({linked:true,code:null});
  await env.DB.prepare('DELETE FROM link_codes WHERE token_hash=?').bind(hash).run();
  const code=randomCode(),expiresAt=nowSeconds()+600;
  await env.DB.prepare('INSERT INTO link_codes(code_hash,token_hash,expires_at) VALUES(?,?,?)').bind(await sha256(code),hash,expiresAt).run();
  return json({linked:false,code,expiresAt,command:`VINCULAR ${code}`});
 }
 const linked=await device(request,env);if(!linked)return json({error:'Dispositivo não reconhecido'},401);
 if(path==='/v1/device/status'&&request.method==='GET')return json({linked:!!linked.wa_id});
 if(path==='/v1/device/unlink'&&request.method==='POST'){
  await env.DB.prepare('UPDATE devices SET wa_id=NULL,linked_at=NULL WHERE token_hash=?').bind(linked.token_hash).run();
  return json({linked:false});
 }
 if(path==='/v1/device/transactions'&&request.method==='GET'){
  if(!linked.wa_id)return json({error:'Vincule o WhatsApp primeiro'},403);
  const cursor=Number(url.searchParams.get('cursor')||0);
  if(!Number.isSafeInteger(cursor)||cursor<0)return json({error:'Cursor inválido'},400);
  const result=await env.DB.prepare('SELECT rowid AS cursor,id AS remoteId,kind,cents,title,category,occurred_on AS date FROM transactions WHERE wa_id=? AND rowid>? ORDER BY rowid ASC LIMIT 200').bind(linked.wa_id,cursor).all();
  const items=result.results||[];return json({items,nextCursor:items.length?items[items.length-1].cursor:cursor,hasMore:items.length===200});
 }
 return json({error:'Rota não encontrada'},404);
}
async function sendWhatsApp(env,phone,text){
 if(!allowedSender(phone,env))return;
 const numberId=String(env.WA_PHONE_NUMBER_ID||'').trim();if(!safeId(numberId)||!env.WA_ACCESS_TOKEN)throw new Error('WhatsApp não configurado');
 const resp=await fetch(`https://graph.facebook.com/${graphVersion(env)}/${numberId}/messages`,{
  method:'POST',headers:{'Authorization':`Bearer ${env.WA_ACCESS_TOKEN}`,'Content-Type':'application/json'},
  body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:phone,type:'text',text:{preview_url:false,body:text.slice(0,4000)}})});
 if(!resp.ok)throw new Error(`Falha de envio WhatsApp HTTP ${resp.status}`);
}
async function voiceToText(env,mediaId){
 if(!env.GROQ_API_KEY)return null;
 if(!/^[0-9]{5,35}$/.test(String(mediaId)))throw new Error('Media ID inválido');
 const metadata=await fetch(`https://graph.facebook.com/${graphVersion(env)}/${mediaId}`,{headers:{Authorization:`Bearer ${env.WA_ACCESS_TOKEN}`}});
 if(!metadata.ok)throw new Error(`Mídia indisponível ${metadata.status}`);
 const meta=await metadata.json();const url=new URL(meta.url);
 // Never forward the Meta bearer token to third-party arbitrary URLs (SSRF).
 if(url.protocol!=='https:' || !(['lookaside.fbsbx.com'].includes(url.hostname) || url.hostname.endsWith('.fbcdn.net')))throw new Error('Host de mídia não permitido');
 if(Number(meta.file_size||0)>8_000_000)throw new Error('Áudio acima de 8 MB');
 const media=await fetch(url,{headers:{Authorization:`Bearer ${env.WA_ACCESS_TOKEN}`}});
 if(!media.ok)throw new Error('Falha ao baixar áudio');
 const bytes=await media.arrayBuffer();if(bytes.byteLength>8_000_000)throw new Error('Áudio acima de 8 MB');
 const mime=String(meta.mime_type||'audio/ogg').split(';')[0];
 const extension=mime==='audio/mpeg'?'mp3':mime==='audio/mp4'?'m4a':mime==='audio/webm'?'webm':'ogg';
 const form=new FormData();form.append('model','whisper-large-v3-turbo');form.append('language','pt');
 form.append('file',new Blob([bytes],{type:mime}),`audio.${extension}`);
 const transcribed=await fetch('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${env.GROQ_API_KEY}`},body:form});
 if(!transcribed.ok)throw new Error(`Falha na transcrição HTTP ${transcribed.status}`);
 const data=await transcribed.json();return typeof data.text==='string'?data.text.slice(0,300):null;
}
async function handleText(env,phone,message,messageId){
 const input=message.trim(),normalized=normalize(input);
 const link=normalized.match(/^vincular\s+([a-z2-9]{12})$/);
 if(link){
   const hash=await sha256(link[1].toUpperCase());
   const linked=await env.DB.prepare('SELECT token_hash FROM link_codes WHERE code_hash=? AND expires_at>?').bind(hash,nowSeconds()).first();
   if(!linked){await sendWhatsApp(env,phone,'Código inválido ou expirado. Gere outro no aplicativo Bolso+.');return;}
   await env.DB.batch([
     env.DB.prepare('UPDATE devices SET wa_id=?,linked_at=CURRENT_TIMESTAMP WHERE token_hash=?').bind(phone,linked.token_hash),
     env.DB.prepare('DELETE FROM link_codes WHERE token_hash=?').bind(linked.token_hash)
   ]);
   await sendWhatsApp(env,phone,'✅ WhatsApp vinculado ao Bolso+! Envie um gasto por texto ou áudio. Confirme com SIM; sincronize no aplicativo para visualizar.');return;
 }
 if(normalized==='ajuda'||normalized==='menu'||normalized==='oi'||normalized==='ola'){
  await sendWhatsApp(env,phone,'👋 Bolso+ Financeiro\n• “gastei 50 reais de bolachas”\n• “recebi 200 reais de serviço”\n• Envie áudio com o gasto\n• SIM / NÃO para confirmar\n• RESUMO para gastos lançados aqui\n• EXTRATO para últimos lançamentos\n• APAGAR TUDO para excluir dados desta conta\n\nOs lançamentos do celular só entram nos totais do app: este chat soma apenas os gastos registrados aqui.');return;
 }
 if(normalized==='resumo'){
  const month=todayBrazil().slice(0,7);
  const x=await env.DB.prepare('SELECT kind,COALESCE(SUM(cents),0) AS cents FROM transactions WHERE wa_id=? AND occurred_on>=? AND occurred_on<? GROUP BY kind').bind(phone,month+'-01',month+'-32').all();
  const totals=Object.fromEntries((x.results||[]).map(v=>[v.kind,v.cents]));
  await sendWhatsApp(env,phone,`📊 Lançamentos pelo WhatsApp (${month})\nEntradas: ${brl(totals.income||0)}\nSaídas: ${brl(totals.expense||0)}\nSaldo apenas deste canal: ${brl((totals.income||0)-(totals.expense||0))}\n\nAbra o Bolso+ para o total com renda fixa e contas do celular.`);return;
 }
 if(normalized==='extrato'){
  const result=await env.DB.prepare('SELECT kind,cents,title,occurred_on FROM transactions WHERE wa_id=? ORDER BY rowid DESC LIMIT 8').bind(phone).all();
  const entries=result.results||[];await sendWhatsApp(env,phone,entries.length?`🧾 Últimos lançamentos enviados aqui:\n${entries.map(v=>`${v.kind==='expense'?'−':'+'} ${brl(v.cents)} · ${v.title} (${v.occurred_on})`).join('\n')}`:'Ainda não há lançamentos pelo WhatsApp.');return;
 }
 if(normalized==='apagar tudo'){
  await env.DB.prepare('INSERT OR REPLACE INTO pending(wa_id,kind,cents,title,category,occurred_on,source_message_id,expires_at) VALUES(?,?,?,?,?,?,?,?)').bind(phone,'delete',0,'','','',messageId,nowSeconds()+300).run();
  await sendWhatsApp(env,phone,'⚠️ Excluir permanentemente TODOS os lançamentos financeiros deste WhatsApp? Responda APAGAR CONFIRMAR em até 5 minutos. O banco do celular não será apagado.');return;
 }
 if(normalized==='apagar confirmar'){
  const row=await env.DB.prepare('SELECT kind,expires_at FROM pending WHERE wa_id=?').bind(phone).first();
  if(row?.kind==='delete'&&row.expires_at>nowSeconds()){
    await env.DB.batch([
      env.DB.prepare('DELETE FROM transactions WHERE wa_id=?').bind(phone),env.DB.prepare('DELETE FROM pending WHERE wa_id=?').bind(phone)
    ]);
    await sendWhatsApp(env,phone,'🗑️ Seus lançamentos deste WhatsApp foram excluídos. Os registros já importados no celular devem ser apagados no app, se desejar.');return;
  }
  await sendWhatsApp(env,phone,'Não há exclusão pendente. Envie APAGAR TUDO para iniciar.');return;
 }
 if(normalized==='nao'||normalized==='não'||normalized==='cancelar'){
  await env.DB.prepare('DELETE FROM pending WHERE wa_id=?').bind(phone).run();
  await sendWhatsApp(env,phone,'Tudo bem! Nenhum gasto novo foi registrado.');return;
 }
 if(normalized==='sim'||normalized==='confirmar'){
  const pending=await env.DB.prepare('SELECT * FROM pending WHERE wa_id=?').bind(phone).first();
  if(!pending||pending.expires_at<=nowSeconds()||pending.kind==='delete'){
    await sendWhatsApp(env,phone,'Nenhum lançamento pendente. Envie o valor e a descrição primeiro.');return;
  }
  const id=crypto.randomUUID();
  await env.DB.prepare('INSERT OR IGNORE INTO transactions(id,wa_id,kind,cents,title,category,occurred_on,source_message_id) VALUES(?,?,?,?,?,?,?,?)')
    .bind(id,phone,pending.kind,pending.cents,pending.title,pending.category,pending.occurred_on,pending.source_message_id).run();
  await env.DB.prepare('DELETE FROM pending WHERE wa_id=? AND source_message_id=?').bind(phone,pending.source_message_id).run();
  await sendWhatsApp(env,phone,`✅ Registrado: ${brl(pending.cents)} · ${pending.category}\n${pending.title}\nAbra o Bolso+ e toque em Sincronizar WhatsApp.`);return;
 }
 const candidate=interpretFinance(input,todayBrazil());
 if(!candidate){await sendWhatsApp(env,phone,'Não entendi o valor. Exemplo: “gastei 50 reais de bolachas”. Para comandos, escreva AJUDA.');return;}
 await env.DB.prepare('INSERT OR REPLACE INTO pending(wa_id,kind,cents,title,category,occurred_on,source_message_id,expires_at) VALUES(?,?,?,?,?,?,?,?)')
 .bind(phone,candidate.kind,candidate.cents,candidate.title,candidate.category,candidate.date,messageId,nowSeconds()+600).run();
 await sendWhatsApp(env,phone,`🧾 Confira:\n${candidate.kind==='income'?'Entrada':'Despesa'}: ${brl(candidate.cents)}\nCategoria: ${candidate.category}\nDescrição: ${candidate.title}\nData: ${candidate.date}\n\nResponda SIM para registrar ou NÃO para cancelar (10 minutos).`);
}
async function processInbox(env,id){
 const stamp=nowSeconds(),lease=stamp-180;
 const claim=await env.DB.prepare("UPDATE inbox SET status='processing',last_attempt=?,attempts=attempts+1 WHERE id=? AND attempts<5 AND (status='queued' OR (status='processing' AND last_attempt<?))").bind(stamp,id,lease).run();
 if(!claim.meta?.changes)return;
 const row=await env.DB.prepare('SELECT sender,payload_json,attempts FROM inbox WHERE id=?').bind(id).first();if(!row)return;
 try{
  const msg=JSON.parse(row.payload_json);
  if(msg.type==='text')await handleText(env,row.sender,msg.text?.body||'',id);
  else if(msg.type==='audio'){
   if(!env.GROQ_API_KEY)await sendWhatsApp(env,row.sender,'🎙️ O áudio está desativado. Configure GROQ_API_KEY no servidor ou envie seu gasto por escrito.');
   else{const transcription=await voiceToText(env,msg.audio?.id);if(!transcription)await sendWhatsApp(env,row.sender,'Não consegui entender o áudio. Tente novamente.');else await handleText(env,row.sender,transcription,id);}
  }else await sendWhatsApp(env,row.sender,'Envie texto ou mensagem de voz. Digite AJUDA para ver os comandos.');
  await env.DB.prepare('DELETE FROM inbox WHERE id=?').bind(id).run();
 }catch(error){
  // Never log payloads, access tokens, audio or personal finance details.
  console.error('WhatsApp event failed',id,String(error?.message||'error').slice(0,100));
  await env.DB.prepare("UPDATE inbox SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'queued' END WHERE id=?").bind(id).run();
 }
}
async function intake(raw,env,ctx){
 let payload;try{payload=JSON.parse(raw);}catch{return json({error:'JSON inválido'},400);}
 if(payload.object!=='whatsapp_business_account')return plain('ok');
 const messages=[];
 for(const entry of payload.entry||[])for(const change of entry.changes||[]){
  if(change.field!=='messages')continue;
  const v=change.value||{};
  if(String(v.metadata?.phone_number_id)!==String(env.WA_PHONE_NUMBER_ID))continue;
  for(const message of v.messages||[]){
   if(!/^wamid\.[A-Za-z0-9_:-]{3,250}$/.test(message.id||''))continue;
   if(!allowedSender(message.from,env))continue;
   messages.push(message);
  }
 }
 for(const message of messages.slice(0,20)){
  const count=await env.DB.prepare("SELECT COUNT(*) AS count FROM received_events WHERE sender=? AND received_at>=datetime('now','-1 day')").bind(message.from).first();
  if(Number(count?.count||0)>=Number(env.MAX_MESSAGES_PER_DAY||100))continue;
  const inserted=await env.DB.prepare('INSERT OR IGNORE INTO received_events(id,sender) VALUES(?,?)').bind(message.id,message.from).run();
  if(!inserted.meta?.changes)continue;
  await env.DB.prepare("INSERT OR IGNORE INTO inbox(id,sender,payload_json) VALUES(?,?,?)").bind(message.id,message.from,JSON.stringify({type:message.type,text:message.text,audio:message.audio})).run();
  ctx.waitUntil(processInbox(env,message.id));
 }
 return plain('ok');
}
export async function handleRequest(request,env,ctx={waitUntil:p=>p.catch(()=>{})}){
 const url=new URL(request.url);
 if(url.pathname==='/health'&&request.method==='GET')return json({status:'ok',version:'1.2.0'});
 if(url.pathname==='/webhook'&&request.method==='GET'){
  const p=url.searchParams;
  return p.get('hub.mode')==='subscribe' && env.WA_VERIFY_TOKEN && p.get('hub.verify_token')===env.WA_VERIFY_TOKEN && p.has('hub.challenge')
   ? plain(p.get('hub.challenge')):plain('unauthorized',403);
 }
 if(url.pathname==='/webhook'&&request.method==='POST'){
  const raw=await request.text();if(raw.length>800_000)return plain('payload too large',413);
  if(!await verifySignature(raw,request.headers.get('x-hub-signature-256'),env.META_APP_SECRET))return plain('invalid signature',401);
  if(!env.DB)return json({error:'Banco indisponível'},503);
  return intake(raw,env,ctx);
 }
 if(url.pathname.startsWith('/v1/device/')){
  if(!env.DB)return json({error:'Banco indisponível'},503);
  return handleDevice(request,env,url);
 }
 return json({error:'Não encontrado'},404);
}
export default {
 async fetch(request,env,ctx){try{return await handleRequest(request,env,ctx);}catch(err){console.error('Request failed',String(err?.message||'error').slice(0,100));return json({error:'Serviço temporariamente indisponível'},503);}},
 async scheduled(_event,env,ctx){
  const rows=await env.DB.prepare("SELECT id FROM inbox WHERE status='queued' OR (status='processing' AND last_attempt<?) ORDER BY created_at LIMIT 20").bind(nowSeconds()-180).all();
  for(const row of rows.results||[])ctx.waitUntil(processInbox(env,row.id));
  ctx.waitUntil(env.DB.prepare("DELETE FROM received_events WHERE received_at<datetime('now','-3 days')").run());
  ctx.waitUntil(env.DB.prepare("DELETE FROM link_codes WHERE expires_at<?").bind(nowSeconds()).run());
  // Expire abandoned inbox payloads; only parsed financial postings persist.
  ctx.waitUntil(env.DB.prepare("DELETE FROM inbox WHERE (status='failed' OR attempts>=5) AND created_at<datetime('now','-1 day')").run());
 }
};
