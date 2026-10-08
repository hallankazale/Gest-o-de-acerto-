# Bolso+ — assistente financeiro de voz (Android)

Aplicativo privado, sem anúncios, mensalidade, conta, servidor ou chave de API.

## Funções
- Reconhecimento de voz em português brasileiro via serviço de fala do Android (a disponibilidade offline depende do dispositivo/pacote de idioma).
- Interpretação **local por regras** de gastos e entradas; não há IA generativa ou servidor externo.
- Prévia com valor/categoria editáveis antes de confirmar; histórico com exclusão, mês anterior/próximo.
- Despesas recorrentes editáveis; renda mensal editável; previsão após fevereiro de 2027.
- Banco SQLite privado e exportação CSV para o local escolhido pelo usuário.
- Interface premium responsiva, gráficos, ícone próprio; sem permissão de Internet.

## Orçamento inicial
Renda: R$ 3.900. Recorrentes: aluguel 900; água/luz 250; pensões 542 e 400; móveis 412 e Ana Loja 300 (essas últimas terminam em fevereiro de 2027).

## Arquitetura
`MainActivity` (host seguro / fala / exportação) → `BudgetDatabase` (SQLite) → interface HTML/CSS/JS local.
`app/src/main/assets/logic.js` isola regras de classificação e orçamento; `ui.js` gerencia a interação.

## Build
Requer Android SDK 35, JDK 17 e Gradle 8.9:

```sh
gradle assembleDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk`.
Ou publique este projeto em um repositório GitHub e use Actions → Compilar Bolso+ APK → artifacts.

## Testes
```sh
node tests/logic.test.cjs
node --check app/src/main/assets/logic.js
node --check app/src/main/assets/ui.js
```

Valide no dispositivo: voz com e sem internet, texto/valores em reais, despesas recorrentes que terminam em fevereiro, alternância mensal, exclusão e persistência após fechar o app. Reconhecimento por voz do Android pode depender da rede e de serviços instalados. Sem IA generativa, a classificação é heurística e a prévia sempre exige confirmação.

**Segurança:** WebView restrita a `file:///android_asset/`, navegação externa bloqueada, sem acesso à Internet para o app, entradas validadas no Android, dados gravados no armazenamento privado, backup do Android desativado. Exportações CSV saem do armazenamento privado somente após escolha do usuário.
