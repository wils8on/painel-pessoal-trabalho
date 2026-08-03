// =========================================================
// js/app.js — Dossiê: Painel Pessoal e de Trabalho
// Vanilla JS (ES6+) + Firebase v10 (modular SDK)
// =========================================================
import { auth, db, googleProvider } from "./firebase-config.js";
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/* ---------------------------------------------------------
   Helpers genéricos
--------------------------------------------------------- */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

function escapeHtml(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Mini-renderizador de Markdown (sem dependências externas):
// suporta #/##/### títulos, **negrito**, *itálico* e listas com "- item"
function mdToHtml(raw = "") {
  const escaped = escapeHtml(raw);
  const lines = escaped.split("\n");
  let html = "";
  let inList = false;
  for (const line of lines) {
    if (/^-\s+/.test(line)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${line.replace(/^-\s+/, "")}</li>`;
      continue;
    } else if (inList) { html += "</ul>"; inList = false; }

    if (/^###\s+/.test(line)) html += `<h3>${line.replace(/^###\s+/, "")}</h3>`;
    else if (/^##\s+/.test(line)) html += `<h2>${line.replace(/^##\s+/, "")}</h2>`;
    else if (/^#\s+/.test(line)) html += `<h1>${line.replace(/^#\s+/, "")}</h1>`;
    else if (line.trim() === "") html += "<br>";
    else html += `<p>${line}</p>`;
  }
  if (inList) html += "</ul>";
  return html
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

function fmtDate(d) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}
function fmtDateTime(d) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

/* ---------------------------------------------------------
   Tema (claro/escuro) — persistido em localStorage
--------------------------------------------------------- */
(function initTheme() {
  const saved = localStorage.getItem("dossie-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
})();

$("#theme-toggle").addEventListener("click", () => {
  const html = document.documentElement;
  const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
  html.setAttribute("data-theme", next);
  localStorage.setItem("dossie-theme", next);
});

/* ---------------------------------------------------------
   Navegação entre módulos (abas)
--------------------------------------------------------- */
function switchView(viewName) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === viewName));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${viewName}`));
  localStorage.setItem("dossie-last-view", viewName);
}
$$(".tab").forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));

/* ---------------------------------------------------------
   Autenticação
--------------------------------------------------------- */
let currentUser = null;
const unsubscribers = []; // listeners do Firestore ativos, para limpar no logout

$("#google-signin-btn").addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    console.error("Falha ao entrar com Google:", err);
    alert("Não foi possível entrar. Verifique sua conexão ou tente novamente.");
  }
});

$("#signout-btn").addEventListener("click", async () => {
  unsubscribers.forEach((u) => u());
  unsubscribers.length = 0;
  await signOut(auth);
});

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    $("#login-screen").classList.add("hidden");
    $("#app-shell").classList.remove("hidden");
    $("#user-photo").src = user.photoURL || "";
    $("#user-name").textContent = user.displayName || user.email || "Usuário";
    switchView(localStorage.getItem("dossie-last-view") || "diario");
    startAllModules(user.uid);
  } else {
    $("#login-screen").classList.remove("hidden");
    $("#app-shell").classList.add("hidden");
  }
});

/* ---------------------------------------------------------
   Firestore — fábrica de CRUD genérico por coleção
   Cada documento inclui userId para isolar os dados por conta.
--------------------------------------------------------- */
function makeCollectionApi(collectionName) {
  const colRef = collection(db, collectionName);
  return {
    subscribe(uid, callback) {
      const q = query(colRef, where("userId", "==", uid));
      const unsub = onSnapshot(q, (snap) => {
        const items = [];
        snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
        callback(items);
      }, (err) => console.error(`Erro ao ler ${collectionName}:`, err));
      unsubscribers.push(unsub);
      return unsub;
    },
    async add(uid, data) {
      return addDoc(colRef, { ...data, userId: uid, createdAt: serverTimestamp() });
    },
    async update(id, data) {
      return updateDoc(doc(db, collectionName, id), { ...data, updatedAt: serverTimestamp() });
    },
    async remove(id) {
      return deleteDoc(doc(db, collectionName, id));
    },
  };
}

const diaryApi = makeCollectionApi("diaryEntries");
const ahsdApi = makeCollectionApi("ahsdNotes");
const kanbanApi = makeCollectionApi("kanbanTasks");
const projectsApi = makeCollectionApi("projects");
const eventsApi = makeCollectionApi("agendaEvents");
const birthdaysApi = makeCollectionApi("birthdays");

function startAllModules(uid) {
  diaryApi.subscribe(uid, renderDiary);
  ahsdApi.subscribe(uid, renderAhsd);
  kanbanApi.subscribe(uid, renderKanban);
  projectsApi.subscribe(uid, renderProjects);
  eventsApi.subscribe(uid, renderEvents);
  birthdaysApi.subscribe(uid, renderBirthdays);
}

/* =========================================================
   MÓDULO 1 — Diário & Ideias Literárias
========================================================= */
let diaryItems = [];
const diaryForm = $("#diario-form-wrap");

$("#diario-new-btn").addEventListener("click", () => {
  $("#diario-edit-id").value = "";
  $("#diario-title").value = "";
  $("#diario-category").value = "Ideia Solta";
  $("#diario-content").value = "";
  diaryForm.classList.remove("hidden");
});
$("#diario-cancel-btn").addEventListener("click", () => diaryForm.classList.add("hidden"));

$("#diario-save-btn").addEventListener("click", async () => {
  const title = $("#diario-title").value.trim();
  const content = $("#diario-content").value.trim();
  if (!title || !content) return alert("Preencha título e conteúdo.");
  const payload = { title, content, category: $("#diario-category").value };
  const editId = $("#diario-edit-id").value;
  try {
    if (editId) await diaryApi.update(editId, payload);
    else await diaryApi.add(currentUser.uid, payload);
    diaryForm.classList.add("hidden");
  } catch (err) {
    console.error(err);
    alert("Não foi possível salvar. Tente novamente.");
  }
});

$("#diario-search").addEventListener("input", renderDiary.bind(null, diaryItems));
$("#diario-filter-cat").addEventListener("change", renderDiary.bind(null, diaryItems));

function renderDiary(items) {
  if (items) diaryItems = items;
  const search = $("#diario-search").value.toLowerCase();
  const cat = $("#diario-filter-cat").value;
  const filtered = diaryItems
    .filter((i) => !cat || i.category === cat)
    .filter((i) => !search || i.title.toLowerCase().includes(search) || i.content.toLowerCase().includes(search))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  $("#diario-empty").classList.toggle("hidden", filtered.length > 0);
  $("#diario-list").innerHTML = filtered.map((item) => `
    <article class="entry-card">
      <div class="entry-card-top">
        <span class="entry-tag">${escapeHtml(item.category)}</span>
      </div>
      <h3 class="entry-title">${escapeHtml(item.title)}</h3>
      <div class="entry-body">${mdToHtml(item.content)}</div>
      <div class="entry-actions">
        <button data-action="edit" data-id="${item.id}">Editar</button>
        <button data-action="delete" data-id="${item.id}">Excluir</button>
      </div>
    </article>
  `).join("");

  $$('#diario-list [data-action="edit"]').forEach((btn) => btn.addEventListener("click", () => {
    const item = diaryItems.find((i) => i.id === btn.dataset.id);
    $("#diario-edit-id").value = item.id;
    $("#diario-title").value = item.title;
    $("#diario-category").value = item.category;
    $("#diario-content").value = item.content;
    diaryForm.classList.remove("hidden");
  }));
  $$('#diario-list [data-action="delete"]').forEach((btn) => btn.addEventListener("click", () => {
    if (confirm("Excluir esta anotação?")) diaryApi.remove(btn.dataset.id);
  }));
}

/* =========================================================
   MÓDULO 2 — Avaliação AH/SD
========================================================= */
let ahsdItems = [];
const ahsdForm = $("#ahsd-form-wrap");

function nowForDatetimeLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

$("#ahsd-new-btn").addEventListener("click", () => {
  $("#ahsd-edit-id").value = "";
  $("#ahsd-datetime").value = nowForDatetimeLocal();
  $("#ahsd-content").value = "";
  ahsdForm.classList.remove("hidden");
});
$("#ahsd-cancel-btn").addEventListener("click", () => ahsdForm.classList.add("hidden"));

$("#ahsd-save-btn").addEventListener("click", async () => {
  const content = $("#ahsd-content").value.trim();
  const dateTime = $("#ahsd-datetime").value;
  if (!content || !dateTime) return alert("Preencha data/hora e observação.");
  const payload = { content, dateTime };
  const editId = $("#ahsd-edit-id").value;
  try {
    if (editId) await ahsdApi.update(editId, payload);
    else await ahsdApi.add(currentUser.uid, payload);
    ahsdForm.classList.add("hidden");
  } catch (err) {
    console.error(err);
    alert("Não foi possível salvar. Tente novamente.");
  }
});

$("#ahsd-search").addEventListener("input", renderAhsd.bind(null, ahsdItems));

function renderAhsd(items) {
  if (items) ahsdItems = items;
  const search = $("#ahsd-search").value.toLowerCase();
  const filtered = ahsdItems
    .filter((i) => !search || i.content.toLowerCase().includes(search))
    .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

  $("#ahsd-empty").classList.toggle("hidden", filtered.length > 0);
  $("#ahsd-list").innerHTML = filtered.map((item) => `
    <div class="timeline-item">
      <div class="timeline-date">${fmtDateTime(new Date(item.dateTime))}</div>
      <p class="timeline-text">${escapeHtml(item.content)}</p>
      <div class="timeline-actions">
        <button data-action="edit" data-id="${item.id}">Editar</button>
        <button data-action="delete" data-id="${item.id}">Excluir</button>
      </div>
    </div>
  `).join("");

  $$('#ahsd-list [data-action="edit"]').forEach((btn) => btn.addEventListener("click", () => {
    const item = ahsdItems.find((i) => i.id === btn.dataset.id);
    $("#ahsd-edit-id").value = item.id;
    $("#ahsd-datetime").value = item.dateTime;
    $("#ahsd-content").value = item.content;
    ahsdForm.classList.remove("hidden");
  }));
  $$('#ahsd-list [data-action="delete"]').forEach((btn) => btn.addEventListener("click", () => {
    if (confirm("Excluir este registro?")) ahsdApi.remove(btn.dataset.id);
  }));
}

/* =========================================================
   MÓDULO 3 — Demandas de Trabalho & BI (Kanban)
========================================================= */
let kanbanItems = [];
const kanbanForm = $("#kanban-form-wrap");

$("#kanban-new-btn").addEventListener("click", () => {
  $("#kanban-edit-id").value = "";
  $("#kanban-title").value = "";
  $("#kanban-desc").value = "";
  kanbanForm.dataset.status = "todo";
  kanbanForm.classList.remove("hidden");
});
$("#kanban-cancel-btn").addEventListener("click", () => kanbanForm.classList.add("hidden"));

$("#kanban-save-btn").addEventListener("click", async () => {
  const title = $("#kanban-title").value.trim();
  if (!title) return alert("Informe um título para a demanda.");
  const payload = { title, description: $("#kanban-desc").value.trim() };
  const editId = $("#kanban-edit-id").value;
  try {
    if (editId) await kanbanApi.update(editId, payload);
    else await kanbanApi.add(currentUser.uid, { ...payload, status: "todo" });
    kanbanForm.classList.add("hidden");
  } catch (err) {
    console.error(err);
    alert("Não foi possível salvar. Tente novamente.");
  }
});

function renderKanban(items) {
  if (items) kanbanItems = items;
  const cols = { todo: [], doing: [], done: [] };
  kanbanItems
    .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
    .forEach((item) => cols[item.status || "todo"].push(item));

  ["todo", "doing", "done"].forEach((status) => {
    $(`#count-${status}`).textContent = cols[status].length;
    $(`#col-${status}`).innerHTML = cols[status].map((item) => `
      <div class="kanban-card" draggable="true" data-id="${item.id}">
        <p class="kanban-card-title">${escapeHtml(item.title)}</p>
        ${item.description ? `<p class="kanban-card-desc">${escapeHtml(item.description)}</p>` : ""}
        <div class="kanban-card-actions">
          <button data-action="edit" data-id="${item.id}">Editar</button>
          <button data-action="delete" data-id="${item.id}">Excluir</button>
        </div>
      </div>
    `).join("");
  });

  $$(".kanban-card").forEach((card) => {
    card.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", card.dataset.id));
  });
  $$('.kanban-card [data-action="edit"]').forEach((btn) => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const item = kanbanItems.find((i) => i.id === btn.dataset.id);
    $("#kanban-edit-id").value = item.id;
    $("#kanban-title").value = item.title;
    $("#kanban-desc").value = item.description || "";
    kanbanForm.classList.remove("hidden");
  }));
  $$('.kanban-card [data-action="delete"]').forEach((btn) => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (confirm("Excluir esta demanda?")) kanbanApi.remove(btn.dataset.id);
  }));
}

$$(".kanban-dropzone").forEach((zone) => {
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    const id = e.dataTransfer.getData("text/plain");
    const status = zone.closest(".kanban-col").dataset.status;
    kanbanApi.update(id, { status });
  });
});

/* =========================================================
   MÓDULO 4 — Projetos & Planos
========================================================= */
let projectItems = [];
const projetoForm = $("#projeto-form-wrap");

$("#projeto-new-btn").addEventListener("click", () => {
  $("#projeto-edit-id").value = "";
  $("#projeto-title").value = "";
  $("#projeto-desc").value = "";
  $("#projeto-progress").value = 0;
  $("#projeto-progress-value").textContent = 0;
  projetoForm.classList.remove("hidden");
});
$("#projeto-cancel-btn").addEventListener("click", () => projetoForm.classList.add("hidden"));
$("#projeto-progress").addEventListener("input", (e) => {
  $("#projeto-progress-value").textContent = e.target.value;
});

$("#projeto-save-btn").addEventListener("click", async () => {
  const title = $("#projeto-title").value.trim();
  if (!title) return alert("Informe o nome do projeto.");
  const payload = {
    title,
    description: $("#projeto-desc").value.trim(),
    progress: Number($("#projeto-progress").value),
  };
  const editId = $("#projeto-edit-id").value;
  try {
    if (editId) await projectsApi.update(editId, payload);
    else await projectsApi.add(currentUser.uid, payload);
    projetoForm.classList.add("hidden");
  } catch (err) {
    console.error(err);
    alert("Não foi possível salvar. Tente novamente.");
  }
});

function renderProjects(items) {
  if (items) projectItems = items;
  const sorted = [...projectItems].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  $("#projeto-empty").classList.toggle("hidden", sorted.length > 0);
  $("#projeto-list").innerHTML = sorted.map((item) => `
    <article class="entry-card">
      <h3 class="entry-title">${escapeHtml(item.title)}</h3>
      ${item.description ? `<p class="entry-body">${escapeHtml(item.description)}</p>` : ""}
      <div class="progress-bar"><div class="progress-fill" style="width:${item.progress || 0}%"></div></div>
      <span class="progress-value">${item.progress || 0}% concluído</span>
      <div class="entry-actions">
        <button data-action="edit" data-id="${item.id}">Editar</button>
        <button data-action="delete" data-id="${item.id}">Excluir</button>
      </div>
    </article>
  `).join("");

  $$('#projeto-list [data-action="edit"]').forEach((btn) => btn.addEventListener("click", () => {
    const item = projectItems.find((i) => i.id === btn.dataset.id);
    $("#projeto-edit-id").value = item.id;
    $("#projeto-title").value = item.title;
    $("#projeto-desc").value = item.description || "";
    $("#projeto-progress").value = item.progress || 0;
    $("#projeto-progress-value").textContent = item.progress || 0;
    projetoForm.classList.remove("hidden");
  }));
  $$('#projeto-list [data-action="delete"]').forEach((btn) => btn.addEventListener("click", () => {
    if (confirm("Excluir este projeto?")) projectsApi.remove(btn.dataset.id);
  }));
}

/* =========================================================
   MÓDULO 5 — Agenda & Aniversários
========================================================= */
let eventItems = [];
let birthdayItems = [];
const eventoForm = $("#evento-form-wrap");
const niverForm = $("#niver-form-wrap");

$("#evento-new-btn").addEventListener("click", () => {
  $("#evento-edit-id").value = "";
  $("#evento-title").value = "";
  $("#evento-date").value = "";
  $("#evento-notes").value = "";
  eventoForm.classList.remove("hidden");
});
$("#evento-cancel-btn").addEventListener("click", () => eventoForm.classList.add("hidden"));

$("#evento-save-btn").addEventListener("click", async () => {
  const title = $("#evento-title").value.trim();
  const date = $("#evento-date").value;
  if (!title || !date) return alert("Preencha título e data do evento.");
  const payload = { title, date, notes: $("#evento-notes").value.trim() };
  const editId = $("#evento-edit-id").value;
  try {
    if (editId) await eventsApi.update(editId, payload);
    else await eventsApi.add(currentUser.uid, payload);
    eventoForm.classList.add("hidden");
  } catch (err) {
    console.error(err);
    alert("Não foi possível salvar. Tente novamente.");
  }
});

function renderEvents(items) {
  if (items) eventItems = items;
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcoming = eventItems
    .filter((i) => i.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date));

  $("#evento-empty").classList.toggle("hidden", upcoming.length > 0);
  $("#evento-list").innerHTML = upcoming.map((item) => `
    <div class="list-item">
      <div class="list-item-main">
        <span class="list-item-title">${escapeHtml(item.title)}</span>
        <span class="list-item-date">${fmtDate(new Date(item.date + "T00:00:00"))}</span>
      </div>
      <div class="list-item-actions">
        <button data-action="edit" data-id="${item.id}">Editar</button>
        <button data-action="delete" data-id="${item.id}">Excluir</button>
      </div>
    </div>
  `).join("");

  $$('#evento-list [data-action="edit"]').forEach((btn) => btn.addEventListener("click", () => {
    const item = eventItems.find((i) => i.id === btn.dataset.id);
    $("#evento-edit-id").value = item.id;
    $("#evento-title").value = item.title;
    $("#evento-date").value = item.date;
    $("#evento-notes").value = item.notes || "";
    eventoForm.classList.remove("hidden");
  }));
  $$('#evento-list [data-action="delete"]').forEach((btn) => btn.addEventListener("click", () => {
    if (confirm("Excluir este evento?")) eventsApi.remove(btn.dataset.id);
  }));
}

$("#niver-new-btn").addEventListener("click", () => {
  $("#niver-edit-id").value = "";
  $("#niver-name").value = "";
  $("#niver-date").value = "";
  niverForm.classList.remove("hidden");
});
$("#niver-cancel-btn").addEventListener("click", () => niverForm.classList.add("hidden"));

$("#niver-save-btn").addEventListener("click", async () => {
  const name = $("#niver-name").value.trim();
  const date = $("#niver-date").value;
  if (!name || !date) return alert("Preencha nome e data de nascimento.");
  const payload = { name, date };
  const editId = $("#niver-edit-id").value;
  try {
    if (editId) await birthdaysApi.update(editId, payload);
    else await birthdaysApi.add(currentUser.uid, payload);
    niverForm.classList.add("hidden");
  } catch (err) {
    console.error(err);
    alert("Não foi possível salvar. Tente novamente.");
  }
});

$("#niver-filter-month").addEventListener("change", renderBirthdays.bind(null, birthdayItems));

// Calcula dias restantes até a próxima ocorrência do aniversário (mês/dia)
function daysUntilNextBirthday(dateStr) {
  const birth = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let next = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, birth.getMonth(), birth.getDate());
  const diffMs = next - today;
  return Math.round(diffMs / 86400000);
}

function renderBirthdays(items) {
  if (items) birthdayItems = items;
  const monthFilter = $("#niver-filter-month").value;
  const filtered = birthdayItems
    .filter((i) => !monthFilter || (new Date(i.date + "T00:00:00").getMonth() + 1) === Number(monthFilter))
    .map((i) => ({ ...i, daysLeft: daysUntilNextBirthday(i.date) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);

  $("#niver-empty").classList.toggle("hidden", filtered.length > 0);
  $("#niver-tbody").innerHTML = filtered.map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td class="mono">${fmtDate(new Date(item.date + "T00:00:00"))}</td>
      <td class="countdown ${item.daysLeft <= 7 ? "soon" : ""}">${item.daysLeft === 0 ? "Hoje!" : `${item.daysLeft} dia(s)`}</td>
      <td>
        <button data-action="edit" data-id="${item.id}">Editar</button>
        <button data-action="delete" data-id="${item.id}">Excluir</button>
      </td>
    </tr>
  `).join("");

  $$('#niver-tbody [data-action="edit"]').forEach((btn) => btn.addEventListener("click", () => {
    const item = birthdayItems.find((i) => i.id === btn.dataset.id);
    $("#niver-edit-id").value = item.id;
    $("#niver-name").value = item.name;
    $("#niver-date").value = item.date;
    niverForm.classList.remove("hidden");
  }));
  $$('#niver-tbody [data-action="delete"]').forEach((btn) => btn.addEventListener("click", () => {
    if (confirm("Excluir este aniversário?")) birthdaysApi.remove(btn.dataset.id);
  }));
}