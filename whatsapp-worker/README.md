# Bolso+ WhatsApp — Backend oficial v1.3.0

Integração oficial **WhatsApp Business Platform Cloud API** com Cloudflare Workers + D1. O APK funciona offline para os registros locais; a conexão com WhatsApp usa HTTPS e requer um backend publicado.

## Arquitetura e segurança

```
WhatsApp pessoal → Meta Cloud API → POST /webhook [HMAC SHA-256]
                              → D1 inbox/retry → parser português
                              → WhatsApp (prévia, SIM/NÃO) → D1 transactions individuais (até 12 por áudio)
Android Bolso+ → HTTPS /v1/device/pair/start → código de vínculo (10 min)
WhatsApp 'VINCULAR CÓDIGO' → D1 devices (identidade WhatsApp)
Android Bolso+ → HTTPS /v1/device/transactions → SQLite local (remote_id UNIQUE)
```

- **Nunca coloque chaves Meta, Groq ou D1 no APK ou no GitHub.** Token do próprio aparelho fica criptografado com Android Keystore.
- Só aceita eventos com assinatura `X-Hub-Signature-256` válida, número remetente na lista `ALLOWED_WA_IDS` e `phone_number_id` configurado.
- Cada número WhatsApp acessa apenas suas transações. Código de vínculo aleatório expira em 10 minutos, com hashes no D1.
- **Sem gravação automática:** o agente separa até 12 despesas/entradas por mensagem, mostra valores e pede `SIM` antes de registrar todo o lote; `NÃO` cancela.
- Mensagens repetidas da Meta são ignoradas; D1 usa IDs remotos únicos; importação não duplica.
- Áudios são baixados temporariamente pelo Worker da URL autenticada da Meta e encaminhados **à Groq** para transcrição somente se `GROQ_API_KEY` estiver configurada. O áudio **não é armazenado** no D1. A transcrição pode conter erros: confira antes de confirmar.
- Raw text de mensagens aguardando processamento fica temporariamente em `inbox` para poder repetir após falhas; não registra payload nos logs. Limpeza periódica recomendada.
- Sem integração não oficial, automação de WhatsApp Web, extração de QR Code ou compra de mensagens.
- Limitação intencional: **sincronização WhatsApp → Android**. Entradas locais, renda fixa e contas recorrentes não são enviadas ao servidor. `RESUMO` no chat considera somente os lançamentos feitos por lá, enquanto o painel do Android soma as contas locais e as transações importadas.

## 1. Conta Cloudflare e D1

Use seu próprio cadastro Cloudflare. Instale Node.js 22+ no PC.

```bash
cd whatsapp-worker
npm install
npx wrangler login
npx wrangler d1 create bolsoplus_whatsapp
```

Copie o UUID retornado pelo comando para `database_id` em `wrangler.toml`. **Não insira tokens privados no arquivo**. Aplique a estrutura:

```bash
npx wrangler d1 migrations apply bolsoplus_whatsapp --remote
```

## 2. API oficial da Meta

1. Crie ou utilize um aplicativo Meta Developers (tipo **Business**) e adicione **WhatsApp**.
2. Na configuração da Cloud API, obtenha `WA_PHONE_NUMBER_ID` e um **system user token** apropriado com permissão `whatsapp_business_messaging` (e os acessos necessários para a conta). **Tokens temporários do painel expiram**, servem apenas para o teste.
3. No painel, identifique o **App Secret**. Crie um token de verificação aleatório e guarde-o para o callback.
4. Cadastre **seu número pessoal** de destino para testes, no formato `55DDDNUMERO` sem `+`, por exemplo `5511999999999`. O número do WhatsApp Business **que recebe** as mensagens é outro número; no modo de teste, use o número atribuído pelo painel.
5. Guarde tudo em segredos do Worker com prompts interativos (não passe tokens diretamente na linha de comando):

```bash
npx wrangler secret put META_APP_SECRET
npx wrangler secret put WA_VERIFY_TOKEN
npx wrangler secret put WA_ACCESS_TOKEN
npx wrangler secret put WA_PHONE_NUMBER_ID
npx wrangler secret put ALLOWED_WA_IDS
npx wrangler secret put GROQ_API_KEY
```

`GROQ_API_KEY` é **opcional para mensagens de texto**, mas necessária para receber voz. Uma conta Groq pode ter limites de teste e cobranças conforme o plano. `ALLOWED_WA_IDS` é obrigatório para evitar contatos desconhecidos acionando o agente e gerando custos. Aceita lista de números separados por vírgula.

## 3. Publicar

```bash
npx wrangler deploy
```

O Worker retorna uma URL do tipo `https://bolsoplus-whatsapp.SUA-CONTA.workers.dev`.

No painel Meta, configure:
- **Callback URL:** `https://bolsoplus-whatsapp.SUA-CONTA.workers.dev/webhook`
- **Verify token:** o texto definido em `WA_VERIFY_TOKEN`
- Assine o evento **messages** para a WhatsApp Business Account correspondente.
- Certifique-se de que a WABA está inscrita no app conectado (em ambientes de produção, conforme a configuração da Meta).

A rota `GET /health` retorna uma confirmação técnica sem expor dados nem segredos. Em produção, números podem precisar de verificação e conta comercial aprovada pela Meta.

## 4. Vincular Bolso+ Android

1. Instale o APK v1.2; abra a aba **WhatsApp**.
2. Cole a URL HTTPS retornada pelo Wrangler; toque **Gerar código de vínculo**.
3. Pelo número pessoal autorizado, envie para o WhatsApp Business da API `VINCULAR CODIGO` (substitua pelo código da tela).
4. Toque **Verificar conexão** até aparecer “Conectado”.
5. Envie “Gastei 50 reais de bolachas e salgadinhos” ou um áudio equivalente; responda **SIM** à prévia.
6. No aplicativo, toque **Sincronizar agora**. No histórico aparecerá o gasto classificado com origem WhatsApp.

**Mudança de aplicativo:** este APK de teste usa assinatura *debug* nova; pode ser necessário desinstalar a versão anterior. Exporte seus dados antes. A API oficial nunca pode ser ativada apenas dentro de um APK estático sem configurar o servidor e a Meta.

## Comandos

| Mensagem | Resultado |
| --- | --- |
| `Gastei 50 reais de bolachas` | Prévia e `SIM` ou `NÃO` |
| `Recebi 200 reais de trabalho` | Prévia de entrada |
| Mensagem de áudio | Transcrição (quando chave Groq configurada); divide várias contas/entradas no mesmo áudio e apresenta prévia item a item |
| `RESUMO` | Totais **apenas** dos lançamentos do WhatsApp |
| `EXTRATO` | Últimos 8 lançamentos do WhatsApp |
| `AJUDA` | Comandos disponíveis |
| `APAGAR TUDO` | Exige confirmação `APAGAR CONFIRMAR` para apagar dados remotos |

## Custos e limitações

- Cloudflare Workers + D1 possuem cotas gratuitas; acima delas haverá falhas ou necessidade de plano pago.
- A Meta pode cobrar pelo envio de mensagens conforme preços **vigentes** da API oficial, inclusive respostas; consulte as taxas atuais antes de ativar cobrança.
- A Groq possui custos e cotas próprias para transcrição; `whisper-large-v3-turbo` é uma opção de baixo custo, **não promete uso ilimitado grátis**.
- Nada é enviado automaticamente a uma LLM para inventar valores: classificação local determinística e confirmação humana antes de salvar. Um agente generativo contextual pode ser incluído depois, com avaliação de risco e limite de gastos.
- A sincronização é iniciada pelo usuário. Sem internet, o app local continua funcionando, mas as mensagens do WhatsApp não sincronizam.
- Excluir dados remotos não apaga cópias já importadas nos celulares. Trate isso separadamente e oriente os titulares sobre privacidade e retenção.

## Testes e qualidade

```bash
npm test
npm run check
cd ..
node tests/logic.test.cjs
```

Coberturas: verificação HMAC, challenge Meta, acesso negado sem credencial, números allowlist, interpretação BRL, vínculo temporário, confirmação `SIM`, idempotência de webhook, isolamento por usuário, cursor de sincronização, desvinculação. Faça **teste com duas contas WhatsApp diferentes e aparelho real** antes de comercializar. Para uso em múltiplos usuários, adicione observabilidade, backups, monitoramento de custos, política de retenção LGPD e controle de consentimento.

## Novidade v1.3: várias despesas e entradas em um áudio

Exemplo: **“Paguei 100 de água, 100 de luz, 100 de internet e recebi 3900 de salário.”**

O servidor transcreve a mensagem (Groq opcional), separa **4 lançamentos** (Água, Luz e Internet como despesas; Salário como entrada) e responde com uma prévia e os totais. Somente `SIM` grava as 4 operações de modo transacional; `NÃO` cancela tudo. IDs de origem por item impedem duplicação mesmo com reentrega de webhook. No app Android v1.3, o microfone local também apresenta uma revisão editável dos quatro itens e grava o lote em uma transação SQLite.

**ATENÇÃO SOBRE O SALÁRIO:** se a renda mensal fixa já tiver sido cadastrada no aplicativo, adicionar o mesmo salário como entrada avulsa fará a renda daquele mês ser contada duas vezes. Escolha um método de contabilização para o salário e confira o painel.

A IA de transcrição pode errar números e nomes; por isso **nenhum item é registrado sem confirmação**. Casos ambíguos (duas contas e só um preço) pedem correção em vez de distribuição automática. O parser é determinístico para reduzir custo e preservar auditabilidade; ele não promete entender toda formulação natural.

**Atualização do servidor já publicado:** execute `npx wrangler d1 migrations apply bolsoplus_whatsapp --remote` para aplicar `0002_multi_entry_audio.sql`, depois `npx wrangler deploy`. Não substitua nem apague a base D1 existente.

## v1.4: situações de pagamento

Execute `npx wrangler d1 migrations apply bolsoplus_whatsapp --remote` **antes de publicar o Worker v1.4**. A migration `0003_settlement_status.sql` conserva as transações anteriores com status `settled`. Mensagens com verbos claros produzem estado distinto `settled`/`pending`, confirmado no WhatsApp; o Android importa e exibe a situação. `A receber` é previsão, não entrada efetivada. Edite ou marque pago/recebido no aplicativo Android. A sincronização segue unidirecional, sem propagar alterações locais ao WhatsApp.
