# Dossiê — Painel Pessoal e de Trabalho

SPA em HTML/CSS/JS puro (sem build step), pronta para GitHub Pages, com Firebase (Google Auth + Cloud Firestore) como backend.

## Estrutura

```
personal-dashboard/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── firebase-config.js      ← cole suas credenciais do Firebase aqui
│   ├── cloudinary-config.js    ← cole seu Cloud name e upload preset aqui
│   └── app.js
└── README.md
```

## 1. Criar o projeto no Firebase

1. Acesse https://console.firebase.google.com e crie um projeto (pode desativar o Google Analytics).
2. Em **Build > Authentication > Sign-in method**, ative o provedor **Google**.
3. Em **Build > Firestore Database**, clique em **Criar banco de dados** e escolha o modo produção (as regras abaixo cuidam da segurança).
4. Em **Configurações do projeto (ícone de engrenagem) > Geral**, role até "Seus apps", clique no ícone `</>` (Web) para registrar um app e copie o objeto `firebaseConfig`.
5. Cole esse objeto em `js/firebase-config.js`, substituindo os placeholders.
6. Em **Authentication > Settings > Authorized domains**, adicione o domínio do seu GitHub Pages, por exemplo `SEUUSUARIO.github.io`.

## 1.1 Cloudinary (upload de imagens e arquivos no Diário)

O Diário permite anexar **várias imagens e arquivos** (PDF, Word, Excel, txt) a cada anotação. Isso usa sua conta Cloudinary (plano gratuito serve bem):

1. Crie uma conta em https://cloudinary.com se ainda não tiver.
2. No [Dashboard](https://console.cloudinary.com), copie o **Cloud name**.
3. Vá em **Settings (engrenagem) > Upload > Upload presets > Add upload preset**.
4. Em **Signing Mode**, escolha **Unsigned** (obrigatório — o app roda só no navegador, sem servidor, então não pode usar a API Secret). Dê um nome ao preset e salve.
5. Recomendado: nesse mesmo preset, defina uma pasta fixa (ex: `nova-app`) e limites de tamanho/formato em "Upload Manipulations" — como o preset unsigned fica exposto no código-fonte, isso evita que alguém use sua conta para hospedar arquivos aleatórios.
6. Abra `js/cloudinary-config.js` e cole o Cloud name e o nome do preset.

Se você excluir uma anotação do Diário (ou remover um anexo específico antes de salvar), o(s) arquivo(s) correspondente(s) **não são apagados automaticamente do Cloudinary** (o app não usa a API Secret, então não consegue deletar remotamente) — eles só deixam de aparecer no app. Se quiser liberar espaço, apague manualmente pelo [Media Library](https://console.cloudinary.com) do Cloudinary.

## 2. Regras de segurança do Firestore

No console: **Firestore Database > Regras**, cole exatamente isto:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Só o próprio dono (usuário autenticado) pode ler/escrever seus documentos.
    // Cada coleção do app segue o mesmo padrão: o campo userId do documento
    // precisa ser igual ao uid de quem está autenticado.
    match /{collection}/{docId} {
      allow read, update, delete: if request.auth != null
                                   && resource.data.userId == request.auth.uid;
      allow create: if request.auth != null
                     && request.resource.data.userId == request.auth.uid;
    }
  }
}
```

### Variante ainda mais restrita (travar para a SUA conta Google específica)

Se você quiser que **somente o seu e-mail** consiga usar o app (mesmo que alguém descubra o `firebaseConfig`, que é público por natureza), substitua o bloco acima por:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{collection}/{docId} {
      allow read, write: if request.auth != null
                          && request.auth.token.email == "seuemail@gmail.com"
                          && (
                               (resource == null && request.resource.data.userId == request.auth.uid) ||
                               (resource != null && resource.data.userId == request.auth.uid)
                             );
    }
  }
}
```

Troque `"seuemail@gmail.com"` pelo e-mail da sua conta Google.

## 3. Publicar no GitHub Pages

1. Crie um repositório novo no GitHub e envie esta pasta (o conteúdo, não a pasta em si, deve estar na raiz do repositório):
   ```bash
   git init
   git add .
   git commit -m "Dossiê: painel pessoal inicial"
   git branch -M main
   git remote add origin https://github.com/SEUUSUARIO/SEUREPOSITORIO.git
   git push -u origin main
   ```
2. No GitHub, vá em **Settings > Pages**, escolha a branch `main` e a pasta `/ (root)`.
3. Aguarde alguns minutos; o site ficará disponível em `https://SEUUSUARIO.github.io/SEUREPOSITORIO/`.
4. Volte no Firebase Console e confirme que esse domínio está em **Authentication > Settings > Authorized domains** (passo 1.6 acima) — sem isso o login com Google é bloqueado.

## Coleções do Firestore usadas pelo app

| Coleção        | Campos principais                                                                                                                                                        | Módulo                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| `diaryEntries` | title, category, book, universe, maturity, narrativeDate, role, motivation, conflict, traits, relatedLiteraryIds[], tags[], attachments[], content, mood, energy, sleepHours, location, weather, favorite, pinned, linkedProjectIds[], linkedGoalIds[], linkedHabitIds[], userId, createdAt | Diário & Ideias Literárias |
| `ahsdNotes`    | dateTime, content, tags[], userId, createdAt                                                                                                                             | Avaliação AH/SD            |
| `kanbanTasks`  | title, description, status, priority, effort, deadline, labels[], context, checklist[], comments[], recurrence, recurrenceGeneratedAt, completedAt, userId, createdAt | Demandas de Trabalho & BI  |
| `projects`     | title, category, priority, status, start, deadline, description, nextSteps, nextAction, hoursEstimated, hoursSpent, risks[], checklist[], usefulLinks[], dependencyProjectIds[], progress, progressLog[], completedAt, userId, createdAt | Projetos & Planos          |
| `agendaEvents` | title, date, notes, userId, createdAt                                                                                                                                    | Agenda (eventos)           |
| `birthdays`    | name, day, month, category, email, phone, photoUrl, company, role, socialUrl, notes, contactFrequencyDays, lastContact, interactions[], linkedProjectIds[], linkedTaskIds[], userId, createdAt | Pessoas e aniversários |
| `goals`        | title, category, priority, status, deadline, description, progress, progressLog[], completedAt, linkedProjectIds[], linkedTaskIds[], linkedHabitIds[], userId, createdAt | Metas                      |
| `habits`       | title, emoji, frequency (diario/semanal/mensal), target, completions[] (datas "YYYY-MM-DD"), notes, userId, createdAt                                                    | Hábitos                    |

`progressLog` é um array de objetos `{ date, percent, note }` — cada vez que você registra uma atualização de progresso (pelo card ou editando o formulário), uma entrada é adicionada, formando um histórico de acompanhamento. O mesmo padrão vale para Projetos e para Metas.

Todas as coleções são criadas automaticamente pelo Firestore na primeira gravação — não é preciso criá-las manualmente.

## Notas de design

- Tema claro/escuro alternável, salvo em `localStorage` (chave `dossie-theme`).
- Navegação desenhada como abas de divisória de fichário: cada módulo tem um código de 3 letras (DIA, AHS, BI, PRJ, AGN) e uma cor própria. No mobile a barra de abas fixa na parte inferior da tela.
- O editor do Diário aceita uma sintaxe leve de Markdown: `# título`, `**negrito**`, `*itálico*` e listas com `- item`.
- Todas as consultas ao Firestore filtram apenas por `userId` (sem `orderBy` composto), e a ordenação final é feita no navegador — isso evita a necessidade de criar índices compostos manualmente no console do Firebase.

## Roadmap — "Life OS" (Fases 1 a 11 concluídas)

O pedido de evolução para um "Life OS" completo tinha 17 frentes. Estamos implementando por fases, para não comprometer a qualidade numa única entrega.

**Fase 1 — inteligência e conexão entre módulos:**

- ✅ **Busca Global (Ctrl+K)** — localiza instantaneamente qualquer item em Diário, AH/SD, Demandas, Projetos, Metas, Hábitos, Agenda e Aniversários, com atalhos de criação rápida.
- ✅ **Resumo do Dia** — card no Dashboard com mensagens contextuais (demandas pendentes, projetos parados, próximo aniversário/prazo, últimas anotações) e uma sugestão automática de prioridade.
- ✅ **Atividade Geral** — aba com timeline cronológica completa de tudo que foi criado/editado, com busca, filtro por categoria e clique para abrir o registro original.
- ✅ **Marcadores comportamentais no AH/SD** — 12 tags predefinidas, gráfico de frequência dos padrões mais comuns e busca/filtro por tag.
- ✅ **Notificações toast** — feedback visual de sucesso/erro substituindo os `alert()` nativos.

**Fase 2 — Metas & Hábitos:**

- ✅ **Tela de Metas** — prazo, progresso, prioridade, categoria, status, descrição, histórico de progresso (igual Projetos) e vínculo opcional com Projetos, Demandas e Hábitos existentes (chips clicáveis que abrem o item vinculado). Cada meta mostra um mini-gráfico (sparkline) da evolução do progresso ao longo do tempo.
- ✅ **Tela de Hábitos** — frequência diária, semanal ou mensal (com meta numérica para semanal/mensal), sequência (streak) calculada automaticamente, mapa de calor dos últimos ~70 dias (estilo GitHub, clicável para marcar/desmarcar qualquer dia) e botão rápido "Marcar hoje".
- ✅ Metas e Hábitos já integrados à Busca Global e à Atividade Geral.
- ✅ **Widgets no Dashboard**: "Metas em destaque" (as próximas do prazo, com barra de progresso) e "Hábitos de hoje" (lista clicável para marcar o período atual sem sair do Dashboard).

**Fase 3 — Insights:**

- ✅ **Tela de Insights** com filtros de 30, 90, 180 e 365 dias ou todo o histórico.
- ✅ Indicadores de itens criados, entregas concluídas, tempo médio de conclusão e consistência dos hábitos.
- ✅ Evolução mensal de criação e conclusão, distribuição das demandas por status e rankings de hábitos e metas.
- ✅ Leitura automática do período com taxa de conversão, hábito mais consistente e progresso médio das metas.

**Fase 4 — Projetos avançados:**

- ✅ Próxima ação destacada, horas estimadas/gastas e riscos ou impedimentos.
- ✅ Checklist estruturado e clicável, com cálculo automático do progresso e registro no histórico.
- ✅ Links úteis e dependências entre projetos, com navegação direta entre os cards relacionados.
- ✅ Saúde dos projetos integrada à leitura automática da tela de Insights.

**Fase 5 — Demandas avançadas:**

- ✅ Prioridade, esforço, prazo, etiquetas, responsável/contexto e busca com filtros.
- ✅ Checklist clicável e comentários diretamente nos cards do Kanban.
- ✅ Recorrência semanal ou mensal, criando automaticamente a próxima demanda ao concluir a atual.
- ✅ Carga de esforço e demandas atrasadas integradas à tela de Insights.

**Fase 6 — Diário contextual:**

- ✅ Humor, energia, sono, local e clima em cada anotação.
- ✅ Editor Markdown ampliado com prévia ao vivo e templates de escrita.
- ✅ Favoritos, registros fixados e vínculos com projetos, metas e hábitos.
- ✅ Médias de energia e sono e humor mais frequente integrados aos Insights.

**Fase 7 — Universo Literário:**

- ✅ Espaço próprio para personagens, cenas, capítulos, tramas, locais, objetos e pesquisas.
- ✅ Organização por obra/série/universo, maturidade e momento narrativo.
- ✅ Ficha narrativa com papel, motivação, conflito e traços de personagem.
- ✅ Relações clicáveis entre elementos e painel de cobertura por tipo.
- ✅ Indicadores literários integrados aos Insights.

**Fase 8 — Pessoas e Relacionamentos:**

- ✅ Aniversários evoluídos para perfis completos de pessoas, sem migração manual.
- ✅ Contatos, empresa, cargo, categoria, foto, redes sociais e notas.
- ✅ Frequência desejada de contato, último contato e histórico de interações.
- ✅ Vínculos com projetos e demandas e alertas de contato pendente.
- ✅ Indicadores de relacionamento integrados aos Insights.

**Fase 9 — Produtividade avançada:**

- ✅ Mapa de calor geral e pontuação semanal de produtividade.
- ✅ Comparação entre períodos e ritmo por dia da semana.
- ✅ Correlação entre energia e atividade, alertas de carga e baixa atividade.
- ✅ Resumo automático dos últimos sete dias e widget configurável no Dashboard.
- ✅ Exportação consolidada dos indicadores em CSV.

**Fase 10 — UX, confiabilidade e mobile:**

- ✅ PWA instalável, shell offline e indicador de conexão.
- ✅ Backup completo em JSON e restauração protegida por confirmação.
- ✅ Estado global de carregamento e mensagens de erro de sincronização.
- ✅ Proteção contra saída com alterações não salvas.
- ✅ Atalhos: `/` ou `Ctrl+K` busca, `N` novo item, `Alt+1…0` navegação e `Esc` fechar.
- ✅ Preferências persistentes, contraste reforçado e refinamentos mobile.

**Fase 11 — Qualidade e estabilização:**

- ✅ Utilitários críticos extraídos para módulo independente e testável.
- ✅ Testes automatizados de percentuais, checklists, recorrência, URLs e backups.
- ✅ Verificação automática no GitHub Actions a cada push ou pull request.
- ✅ Regras do Firestore restritas às coleções conhecidas e sem troca de proprietário.
- ✅ Validação reforçada de backup, limite de tamanho e coleções permitidas.
- ✅ Consistência automática entre progresso e status de Projetos e Metas.
- ✅ Registro local dos últimos erros não tratados e melhorias de acessibilidade.

### Testes e segurança

Execute `npm test` para rodar a suíte de testes. O arquivo `firestore.rules` contém as regras endurecidas; publique-o pelo Firebase CLI ou copie seu conteúdo para **Firestore Database → Regras** no Console do Firebase.

**Ainda não implementado** (próximas fases):


Cada uma dessas frentes pode ser pedida como uma próxima fase separada.
