# Dossiê — Painel Pessoal e de Trabalho

SPA em HTML/CSS/JS puro (sem build step), pronta para GitHub Pages, com Firebase (Google Auth + Cloud Firestore) como backend.

## Estrutura

```
personal-dashboard/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── firebase-config.js   ← cole suas credenciais aqui
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

| Coleção        | Campos principais                               | Módulo                     |
| -------------- | ----------------------------------------------- | -------------------------- |
| `diaryEntries` | title, category, content, userId, createdAt     | Diário & Ideias Literárias |
| `ahsdNotes`    | dateTime, content, userId, createdAt            | Avaliação AH/SD            |
| `kanbanTasks`  | title, description, status, userId, createdAt   | Demandas de Trabalho & BI  |
| `projects`     | title, description, progress, userId, createdAt | Projetos & Planos          |
| `agendaEvents` | title, date, notes, userId, createdAt           | Agenda (eventos)           |
| `birthdays`    | name, date, userId, createdAt                   | Agenda (aniversários)      |

Todas as coleções são criadas automaticamente pelo Firestore na primeira gravação — não é preciso criá-las manualmente.

## Notas de design

- Tema claro/escuro alternável, salvo em `localStorage` (chave `dossie-theme`).
- Navegação desenhada como abas de divisória de fichário: cada módulo tem um código de 3 letras (DIA, AHS, BI, PRJ, AGN) e uma cor própria. No mobile a barra de abas fixa na parte inferior da tela.
- O editor do Diário aceita uma sintaxe leve de Markdown: `# título`, `**negrito**`, `*itálico*` e listas com `- item`.
- Todas as consultas ao Firestore filtram apenas por `userId` (sem `orderBy` composto), e a ordenação final é feita no navegador — isso evita a necessidade de criar índices compostos manualmente no console do Firebase.
