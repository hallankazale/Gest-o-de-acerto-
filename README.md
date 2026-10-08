# Bolso+ — Finanças em ordem (Android) | v1.1.0

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
