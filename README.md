# Bolso+ — Finanças em ordem (Android) | v1.4.0

Aplicativo Android de orçamento pessoal com interface escura premium, acompanhamento de porcentagens e entrada por texto/voz, sem conta, anúncios, assinatura, servidor próprio nem permissão de Internet.

## Primeira execução: totalmente em branco

- **Renda fixa: R$ 0,00**, ainda não cadastrada.
- **Contas recorrentes: nenhuma**.
- **Lançamentos de entrada/saída: nenhum**.
- Dashboard com orientações de início. Gráficos não apresentam porcentagem inventada enquanto a renda é zero.
- A frase “gastei cinquenta reais de bolachas e salgadinhos” prepara uma despesa de R$ 50 em Alimentação; usuário confirma ou ajusta antes de gravar.

## Fluxos

1. Em **Resumo**, selecionar **Definir renda** (ou usar Contas > editar renda).
2. Adicionar contas mensais, com mês inicial e último mês opcionais.
3. Falar no microfone (reconhecimento via serviços do Android) ou digitar uma frase, conferir valor, data e categoria, e salvar.
4. Em **Histórico**, criar manualmente, editar ou excluir lançamentos.
5. Em **Contas**, editar/excluir despesas fixas; embaixo, usar **Apagar todos os meus dados** digitando `APAGAR` para confirmar exclusão. Não há botão de limpeza automática.
6. No topo, **Exportar CSV** guarda renda, contas e histórico em documento escolhido pelo usuário.

## Arquitetura e segurança

- `MainActivity.java`: host Android WebView, reconhecimento de fala e exportação segura do CSV (Storage Access Framework).
- `BudgetDatabase.java`: SQLite local privado, valores em centavos, validação e transações (limpeza atômica).
- `assets/logic.js`: regras puras de dinheiro, resumo e categorização; sem necessidade de rede e sem IA generativa.
- `assets/ui.js`, `index.html`, `styles.css`: interface local responsiva, separada da persistência.
- Dados locais; CSP estrita; sem permissão Internet; backup automático Android desativado. CSV precisa de ação explícita do usuário.
- Em instalações com dados anteriores e assinatura compatível, o upgrade preserva lançamentos; só a limpeza confirmada remove. Builds debug em CI podem usar assinatura diferente: se Android recusar atualização, desinstale a v1 antes de instalar v1.1.0, **o que apaga os dados anteriores**. Exporte antes se necessário.

## Compilação

Requer JDK 17, Gradle 8.9, Android SDK 35: `gradle assembleDebug`.

No GitHub, cada push à branch `bolsoplus/android-v1` aciona **Compilar Bolso+ APK**. Em Actions, baixe o artefato `BolsoPlus-v1.1-limpo-apk`.

## Testes

```bash
node tests/logic.test.cjs
node --check app/src/main/assets/ui.js
node --check app/src/main/assets/logic.js
```

Faça testes manuais no celular: abertura sem nenhum dado, renda zero, lançamento por voz e texto (incluindo valores por extenso), edição, exclusão, conta recorrente, mês seguinte, CSV e reset com confirmação. Verifique uso offline: a classificação funciona, mas o serviço de voz Android pode exigir conectividade ou pacote local de idioma.


## WhatsApp Business Cloud API (v1.2.0)

Nova aba **WhatsApp** no Android com vínculo de código temporário e importação segura de gastos após confirmação `SIM`. O backend fica em `whatsapp-worker/` e tem instruções de Cloudflare/Meta, esquema D1 e testes de segurança no próprio diretório. A API não inicia sozinha: configure Meta + Cloudflare + segredos para usá-la. Sem servidor ativo, o aplicativo continua funcionando offline.


## Versão 1.3 — múltiplos gastos e renda em um único áudio

- Assistente de WhatsApp separa até 12 lançamentos no mesmo texto/áudio e pede confirmação do lote.
- Nova migração D1 `whatsapp-worker/migrations/0002_multi_entry_audio.sql` preserva registros antigos.
- O microfone do Android também permite revisar, editar, categorizar e salvar múltiplas despesas/entradas de uma única vez, atomicamente.
- Para ativar no WhatsApp, publique o Worker na sua conta Cloudflare; **o APK sozinho não recebe mensagens da Meta**.
- Salários enviados como entrada avulsa contam como entrada adicional. Evite contar a mesma renda também na configuração de renda fixa.


## Versão 1.4 — pago, a pagar, recebido, a receber

- Extração determinística de até 12 itens em português brasileiro preservando o verbo e o tempo. Exemplos: `paguei 100 de água` → despesa liquidada; `tenho que pagar 100 de luz` → despesa pendente; `recebi 3900 de salário` → entrada recebida; `vou receber 200 de serviço` → entrada a receber.
- Sem verbo explícito, o aplicativo evita presumir uma transferência financeira. O usuário corrige o estado antes de confirmar.
- `status` salvo em SQLite Android (migração v3→v4) e D1 Cloudflare (migration 0003). A migração preserva lançamentos antigos, assumindo-os liquidado, como na versão anterior.
- A aba Histórico permite editar estado ou marcar um pendente como pago/recebido com um toque e confirmação.
- `A receber` não entra no saldo previsto até que o estado mude. `A pagar` já é compromisso no total do orçamento. O painel distingue os dois.
- **Limitação:** contas recorrentes planejadas e gastos avulsos são independentes. Se a mesma fatura for cadastrada em ambos, ela poderá ser contada duas vezes. No lançamento, evite duplicatas; reconciliação de faturas recorrentes é etapa futura.
- WhatsApp Cloud API requer atualizar Worker/D1 e configurar Meta/Groq pelo proprietário. A integração não é ativada só ao instalar o APK.
