// =========================================================
// js/app.js — Nova: Painel Pessoal e de Trabalho
// Vanilla JS (ES6+) + Firebase v10 (modular SDK)
// =========================================================
import { auth, db, googleProvider } from "./firebase-config.js";
import { uploadImageToCloudinary } from "./cloudinary-config.js";
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
function fmtDayMonth(day, month) {
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
}
function tsToDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  if (ts.seconds) return new Date(ts.seconds * 1000);
  return null;
}
function relativeTime(date) {
  if (!date) return "";
  const diffMs = Date.now() - date.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `há ${hrs} h`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `há ${days} d`;
  return fmtDate(date);
}

/* ---------------------------------------------------------
   Tema (claro/escuro) — persistido em localStorage
--------------------------------------------------------- */
(function initTheme() {
  const saved = localStorage.getItem("nova-theme");
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  const theme = saved || (prefersLight ? "light" : "dark");
  document.documentElement.setAttribute("data-theme", theme);
})();

$("#theme-toggle").addEventListener("click", () => {
  const html = document.documentElement;
  const next = html.getAttribute("data-theme") === "light" ? "dark" : "light";
  html.setAttribute("data-theme", next);
  localStorage.setItem("nova-theme", next);
});

/* ---------------------------------------------------------
   Navegação entre módulos
--------------------------------------------------------- */
function switchView(viewName) {
  $$(".rail-btn").forEach((t) => t.classList.toggle("active", t.dataset.view === viewName));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${viewName}`));
  localStorage.setItem("nova-last-view", viewName);
}
$$(".rail-btn").forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));

/* ---------------------------------------------------------
   Relógio & saudação do Dashboard
--------------------------------------------------------- */
function updateClock() {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Bom dia," : hour < 18 ? "Boa tarde," : "Boa noite,";
  $("#dash-greeting").textContent = greeting;
  $("#dash-clock-time").textContent = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(now);
  $("#dash-clock-date").textContent = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(now);
}
setInterval(updateClock, 30000);

/* ---------------------------------------------------------
   Autenticação
--------------------------------------------------------- */
let currentUser = null;
const unsubscribers = [];

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
    $("#user-photo").title = user.displayName || user.email || "";
    $("#dash-username").textContent = (user.displayName || user.email || "Usuário").split(" ")[0];
    updateClock();
    switchView(localStorage.getItem("nova-last-view") || "dashboard");
    populateDaySelect();
    startAllModules(user.uid);
  } else {
    $("#login-screen").classList.remove("hidden");
    $("#app-shell").classList.add("hidden");
  }
});

/* ---------------------------------------------------------
   Firestore — fábrica de CRUD genérico por coleção
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
const diaryImageFile = $("#diario-image-file");
const diaryImageStatus = $("#diario-image-status");
const diaryImagePreviewWrap = $("#diario-image-preview-wrap");
const diaryImagePreview = $("#diario-image-preview");
const diaryImageLabelText = $("#diario-image-label-text");

function resetDiaryImageField() {
  $("#diario-image-url").value = "";
  diaryImageFile.value = "";
  diaryImagePreviewWrap.classList.add("hidden");
  diaryImagePreview.src = "";
  diaryImageStatus.textContent = "";
  diaryImageLabelText.textContent = "Adicionar imagem de capa";
}

function setDiaryImagePreview(url) {
  $("#diario-image-url").value = url || "";
  if (url) {
    diaryImagePreview.src = url;
    diaryImagePreviewWrap.classList.remove("hidden");
    diaryImageLabelText.textContent = "Trocar imagem de capa";
  } else {
    diaryImagePreviewWrap.classList.add("hidden");
    diaryImagePreview.src = "";
    diaryImageLabelText.textContent = "Adicionar imagem de capa";
  }
}

diaryImageFile.addEventListener("change", async () => {
  const file = diaryImageFile.files[0];
  if (!file) return;
  diaryImageStatus.textContent = "Enviando imagem…";
  try {
    const url = await uploadImageToCloudinary(file);
    setDiaryImagePreview(url);
    diaryImageStatus.textContent = "Imagem enviada ✓";
    setTimeout(() => { diaryImageStatus.textContent = ""; }, 2500);
  } catch (err) {
    console.error(err);
    diaryImageStatus.textContent = "";
    alert(err.message || "Não foi possível enviar a imagem.");
    diaryImageFile.value = "";
  }
});
$("#diario-image-remove").addEventListener("click", () => setDiaryImagePreview(""));

function populateDiaryBookFilter() {
  const select = $("#diario-filter-book");
  const current = select.value;
  const books = [...new Set(diaryItems.map((i) => i.book).filter(Boolean))].sort();
  select.innerHTML = `<option value="">Todos os livros/projetos</option>` +
    books.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join("");
  if (books.includes(current)) select.value = current;
}

$("#diario-new-btn").addEventListener("click", () => {
  $("#diario-edit-id").value = "";
  $("#diario-title").value = "";
  $("#diario-book").value = "";
  $("#diario-status").value = "Rascunho";
  $("#diario-category").value = "Ideia Solta";
  $("#diario-tags").value = "";
  $("#diario-content").value = "";
  resetDiaryImageField();
  diaryForm.classList.remove("hidden");
});
$("#diario-cancel-btn").addEventListener("click", () => diaryForm.classList.add("hidden"));

$("#diario-save-btn").addEventListener("click", async () => {
  const title = $("#diario-title").value.trim();
  const content = $("#diario-content").value.trim();
  if (!title || !content) return alert("Preencha título e conteúdo.");
  const tags = $("#diario-tags").value.split(",").map((t) => t.trim()).filter(Boolean);
  const payload = {
    title,
    content,
    category: $("#diario-category").value,
    book: $("#diario-book").value.trim(),
    status: $("#diario-status").value,
    tags,
    imageUrl: $("#diario-image-url").value || null,
  };
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

$("#diario-search").addEventListener("input", () => renderDiary());
$("#diario-filter-cat").addEventListener("change", () => renderDiary());
$("#diario-filter-book").addEventListener("change", () => renderDiary());

function renderDiary(items) {
  if (items) diaryItems = items;
  populateDiaryBookFilter();
  const search = $("#diario-search").value.toLowerCase();
  const cat = $("#diario-filter-cat").value;
  const book = $("#diario-filter-book").value;
  const filtered = diaryItems
    .filter((i) => !cat || i.category === cat)
    .filter((i) => !book || i.book === book)
    .filter((i) => !search ||
      i.title.toLowerCase().includes(search) ||
      i.content.toLowerCase().includes(search) ||
      (i.tags || []).some((t) => t.toLowerCase().includes(search)) ||
      (i.book || "").toLowerCase().includes(search))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  $("#diario-empty").classList.toggle("hidden", filtered.length > 0);
  $("#diario-list").innerHTML = filtered.map((item) => `
    <article class="entry-card">
      ${item.imageUrl ? `<img src="${item.imageUrl}" class="entry-cover" alt="Capa de ${escapeHtml(item.title)}" loading="lazy">` : ""}
      <div class="entry-card-top">
        <span class="entry-tag" style="background:var(--amber-soft); color:var(--amber);">${escapeHtml(item.category)}</span>
        <span class="badge badge-status">${escapeHtml(item.status || "Rascunho")}</span>
      </div>
      <h3 class="entry-title">${escapeHtml(item.title)}</h3>
      ${item.book ? `<p class="entry-meta"><span>📖 ${escapeHtml(item.book)}</span></p>` : ""}
      <div class="entry-body">${mdToHtml(item.content)}</div>
      ${(item.tags || []).length ? `<div class="entry-tags">${item.tags.map((t) => `<span class="tag-chip">#${escapeHtml(t)}</span>`).join("")}</div>` : ""}
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
    $("#diario-book").value = item.book || "";
    $("#diario-status").value = item.status || "Rascunho";
    $("#diario-category").value = item.category;
    $("#diario-tags").value = (item.tags || []).join(", ");
    $("#diario-content").value = item.content;
    setDiaryImagePreview(item.imageUrl || "");
    diaryImageStatus.textContent = "";
    diaryForm.classList.remove("hidden");
  }));
  $$('#diario-list [data-action="delete"]').forEach((btn) => btn.addEventListener("click", () => {
    if (confirm("Excluir esta anotação?")) diaryApi.remove(btn.dataset.id);
  }));

  refreshDashboard();
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

$("#ahsd-search").addEventListener("input", () => renderAhsd());

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

  refreshDashboard();
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
  [...kanbanItems]
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

  refreshDashboard();
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
   MÓDULO 4 — Projetos & Planos (formulário detalhado)
========================================================= */
let projectItems = [];
const projetoForm = $("#projeto-form-wrap");

const PRIORITY_BADGE = { Baixa: "badge-baixa", Media: "badge-media", Alta: "badge-alta", Critica: "badge-critica" };
const PRIORITY_LABEL = { Baixa: "Baixa", Media: "Média", Alta: "Alta", Critica: "Crítica" };

$("#projeto-new-btn").addEventListener("click", () => {
  $("#projeto-edit-id").value = "";
  $("#projeto-title").value = "";
  $("#projeto-category").value = "Sistema/TI";
  $("#projeto-priority").value = "Media";
  $("#projeto-status").value = "Planejamento";
  $("#projeto-start").value = "";
  $("#projeto-deadline").value = "";
  $("#projeto-desc").value = "";
  $("#projeto-next").value = "";
  $("#projeto-progress").value = 0;
  $("#projeto-progress-value").textContent = 0;
  projetoForm.classList.remove("hidden");
});
$("#projeto-cancel-btn").addEventListener("click", () => projetoForm.classList.add("hidden"));
$("#projeto-progress").addEventListener("input", (e) => {
  $("#projeto-progress-value").textContent = e.target.value;
});
$("#projeto-filter-status").addEventListener("change", () => renderProjects());

$("#projeto-save-btn").addEventListener("click", async () => {
  const title = $("#projeto-title").value.trim();
  if (!title) return alert("Informe o nome do projeto.");
  const newProgress = Number($("#projeto-progress").value);
  const editId = $("#projeto-edit-id").value;
  const existing = editId ? projectItems.find((i) => i.id === editId) : null;
  const existingLog = existing?.progressLog || [];

  const payload = {
    title,
    category: $("#projeto-category").value,
    priority: $("#projeto-priority").value,
    status: $("#projeto-status").value,
    start: $("#projeto-start").value || null,
    deadline: $("#projeto-deadline").value || null,
    description: $("#projeto-desc").value.trim(),
    nextSteps: $("#projeto-next").value.trim(),
    progress: newProgress,
  };

  // Só registra uma entrada no histórico se o progresso realmente mudou
  // (evita poluir o histórico ao editar só a descrição, por exemplo).
  if (!existing || existing.progress !== newProgress) {
    payload.progressLog = [...existingLog, { date: new Date().toISOString(), percent: newProgress, note: existing ? "Atualizado pelo formulário" : "Criação do projeto" }];
  }

  try {
    if (editId) await projectsApi.update(editId, payload);
    else await projectsApi.add(currentUser.uid, payload);
    projetoForm.classList.add("hidden");
  } catch (err) {
    console.error(err);
    alert("Não foi possível salvar. Tente novamente.");
  }
});

// Registra uma nova atualização de progresso diretamente pelo card,
// sem precisar reabrir o formulário completo — e guarda no histórico.
async function quickUpdateProgress(id, percent, note) {
  const item = projectItems.find((i) => i.id === id);
  if (!item) return;
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  const log = [...(item.progressLog || []), { date: new Date().toISOString(), percent: clamped, note: note?.trim() || "" }];
  try {
    await projectsApi.update(id, { progress: clamped, progressLog: log });
  } catch (err) {
    console.error(err);
    alert("Não foi possível registrar a atualização. Tente novamente.");
  }
}

function renderProjects(items) {
  if (items) projectItems = items;
  const statusFilter = $("#projeto-filter-status").value;
  const todayStr = new Date().toISOString().slice(0, 10);
  const sorted = [...projectItems]
    .filter((i) => !statusFilter || i.status === statusFilter)
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  $("#projeto-empty").classList.toggle("hidden", sorted.length > 0);
  $("#projeto-list").innerHTML = sorted.map((item) => {
    const overdue = item.deadline && item.deadline < todayStr && item.status !== "Concluido";
    const priorityClass = PRIORITY_BADGE[item.priority] || "badge-media";
    const log = item.progressLog || [];
    const logEntriesHtml = [...log].reverse().map((entry) => `
      <div class="progress-log-entry">
        <span class="log-date">${fmtDateTime(new Date(entry.date))}</span>
        <span class="log-pct">${entry.percent}%</span>
        ${entry.note ? `<span class="log-note">${escapeHtml(entry.note)}</span>` : ""}
      </div>
    `).join("");

    return `
    <article class="entry-card">
      <div class="entry-card-top">
        <span class="entry-tag" style="background:var(--teal-soft); color:var(--teal);">${escapeHtml(item.category || "Outro")}</span>
        <span class="badge ${priorityClass}">${PRIORITY_LABEL[item.priority] || item.priority}</span>
        <span class="badge badge-status">${escapeHtml(item.status || "Planejamento")}</span>
        ${overdue ? `<span class="badge badge-overdue">Atrasado</span>` : ""}
      </div>
      <h3 class="entry-title">${escapeHtml(item.title)}</h3>
      ${item.description ? `<p class="entry-body">${escapeHtml(item.description)}</p>` : ""}
      ${item.nextSteps ? `<p class="entry-body"><strong>Próximos passos:</strong> ${escapeHtml(item.nextSteps)}</p>` : ""}
      <div class="entry-meta">
        ${item.start ? `<span>Início: ${fmtDate(new Date(item.start + "T00:00:00"))}</span>` : ""}
        ${item.deadline ? `<span>Prazo: ${fmtDate(new Date(item.deadline + "T00:00:00"))}</span>` : ""}
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${item.progress || 0}%"></div></div>
      <span class="progress-value">${item.progress || 0}% concluído</span>

      <div class="progress-log">
        <button type="button" class="progress-log-toggle" data-action="toggle-log" data-id="${item.id}">
          Acompanhar progresso ${log.length ? `(${log.length} registro${log.length > 1 ? "s" : ""})` : ""} ▾
        </button>
        <div class="progress-log-panel hidden" id="log-panel-${item.id}">
          ${logEntriesHtml ? `<div class="progress-log-entries">${logEntriesHtml}</div>` : `<p class="empty-state small">Nenhuma atualização registrada ainda.</p>`}
          <div class="progress-log-form">
            <div class="form-row form-row-2">
              <label class="field-label">Novo progresso (%)
                <input type="number" min="0" max="100" class="input mono" id="quick-progress-${item.id}" value="${item.progress || 0}" />
              </label>
              <label class="field-label">Observação (opcional)
                <input type="text" class="input" id="quick-note-${item.id}" placeholder="O que mudou?" />
              </label>
            </div>
            <div class="form-actions">
              <button class="btn btn-primary btn-sm" data-accent="teal" data-action="quick-update" data-id="${item.id}">Registrar atualização</button>
            </div>
          </div>
        </div>
      </div>

      <div class="entry-actions">
        <button data-action="edit" data-id="${item.id}">Editar</button>
        <button data-action="delete" data-id="${item.id}">Excluir</button>
      </div>
    </article>
  `;
  }).join("");

  $$('#projeto-list [data-action="toggle-log"]').forEach((btn) => btn.addEventListener("click", () => {
    $(`#log-panel-${btn.dataset.id}`).classList.toggle("hidden");
  }));
  $$('#projeto-list [data-action="quick-update"]').forEach((btn) => btn.addEventListener("click", async () => {
    const id = btn.dataset.id;
    const percent = $(`#quick-progress-${id}`).value;
    const note = $(`#quick-note-${id}`).value;
    await quickUpdateProgress(id, percent, note);
  }));
  $$('#projeto-list [data-action="edit"]').forEach((btn) => btn.addEventListener("click", () => {
    const item = projectItems.find((i) => i.id === btn.dataset.id);
    $("#projeto-edit-id").value = item.id;
    $("#projeto-title").value = item.title;
    $("#projeto-category").value = item.category || "Sistema/TI";
    $("#projeto-priority").value = item.priority || "Media";
    $("#projeto-status").value = item.status || "Planejamento";
    $("#projeto-start").value = item.start || "";
    $("#projeto-deadline").value = item.deadline || "";
    $("#projeto-desc").value = item.description || "";
    $("#projeto-next").value = item.nextSteps || "";
    $("#projeto-progress").value = item.progress || 0;
    $("#projeto-progress-value").textContent = item.progress || 0;
    projetoForm.classList.remove("hidden");
  }));
  $$('#projeto-list [data-action="delete"]').forEach((btn) => btn.addEventListener("click", () => {
    if (confirm("Excluir este projeto?")) projectsApi.remove(btn.dataset.id);
  }));

  refreshDashboard();
}

/* =========================================================
   MÓDULO 5 — Agenda & Aniversários
========================================================= */
let eventItems = [];
let birthdayItems = [];
const eventoForm = $("#evento-form-wrap");
const niverForm = $("#niver-form-wrap");

function populateDaySelect() {
  const select = $("#niver-day");
  if (select.options.length) return;
  for (let d = 1; d <= 31; d++) {
    const opt = document.createElement("option");
    opt.value = String(d);
    opt.textContent = String(d).padStart(2, "0");
    select.appendChild(opt);
  }
}

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

function upcomingEvents() {
  const todayStr = new Date().toISOString().slice(0, 10);
  return eventItems.filter((i) => i.date >= todayStr).sort((a, b) => a.date.localeCompare(b.date));
}

function renderEvents(items) {
  if (items) eventItems = items;
  const upcoming = upcomingEvents();

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

  refreshDashboard();
}

$("#niver-new-btn").addEventListener("click", () => {
  $("#niver-edit-id").value = "";
  $("#niver-name").value = "";
  $("#niver-day").value = "1";
  $("#niver-month").value = "1";
  niverForm.classList.remove("hidden");
});
$("#niver-cancel-btn").addEventListener("click", () => niverForm.classList.add("hidden"));

$("#niver-save-btn").addEventListener("click", async () => {
  const name = $("#niver-name").value.trim();
  const day = Number($("#niver-day").value);
  const month = Number($("#niver-month").value);
  if (!name || !day || !month) return alert("Preencha nome, dia e mês.");
  const payload = { name, day, month };
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

$("#niver-filter-month").addEventListener("change", () => renderBirthdays());

// Verifica se o aniversário (dia/mês, sem ano) já passou neste ano e quanto
// tempo falta para a próxima ocorrência.
function nextBirthdayInfo(day, month) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisYear = new Date(today.getFullYear(), month - 1, day);
  thisYear.setHours(0, 0, 0, 0);

  if (thisYear.getTime() === today.getTime()) {
    return { daysLeft: 0, isToday: true, alreadyPassed: false };
  }
  if (thisYear > today) {
    const daysLeft = Math.round((thisYear - today) / 86400000);
    return { daysLeft, isToday: false, alreadyPassed: false };
  }
  const nextYear = new Date(today.getFullYear() + 1, month - 1, day);
  const daysLeft = Math.round((nextYear - today) / 86400000);
  return { daysLeft, isToday: false, alreadyPassed: true };
}

function upcomingBirthdays(limit = 100) {
  return birthdayItems
    .map((i) => ({ ...i, ...nextBirthdayInfo(i.day, i.month) }))
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, limit);
}

function renderBirthdays(items) {
  if (items) birthdayItems = items;
  const monthFilter = $("#niver-filter-month").value;
  const filtered = upcomingBirthdays()
    .filter((i) => !monthFilter || i.month === Number(monthFilter));

  $("#niver-empty").classList.toggle("hidden", filtered.length > 0);
  $("#niver-tbody").innerHTML = filtered.map((item) => {
    let statusHtml;
    if (item.isToday) statusHtml = `<span class="countdown soon">🎉 Hoje!</span>`;
    else if (item.alreadyPassed) statusHtml = `<span class="countdown past">Já passou este ano · próximo em ${item.daysLeft} dia(s)</span>`;
    else statusHtml = `<span class="countdown ${item.daysLeft <= 7 ? "soon" : ""}">Faltam ${item.daysLeft} dia(s)</span>`;

    return `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td class="mono">${fmtDayMonth(item.day, item.month)}</td>
      <td>${statusHtml}</td>
      <td>
        <button data-action="edit" data-id="${item.id}">Editar</button>
        <button data-action="delete" data-id="${item.id}">Excluir</button>
      </td>
    </tr>
  `;
  }).join("");

  $$('#niver-tbody [data-action="edit"]').forEach((btn) => btn.addEventListener("click", () => {
    const item = birthdayItems.find((i) => i.id === btn.dataset.id);
    $("#niver-edit-id").value = item.id;
    $("#niver-name").value = item.name;
    $("#niver-day").value = String(item.day);
    $("#niver-month").value = String(item.month);
    niverForm.classList.remove("hidden");
  }));
  $$('#niver-tbody [data-action="delete"]').forEach((btn) => btn.addEventListener("click", () => {
    if (confirm("Excluir este aniversário?")) birthdaysApi.remove(btn.dataset.id);
  }));

  refreshDashboard();
}

/* =========================================================
   DASHBOARD — resumo agregando todos os módulos
========================================================= */
const KANBAN_META = {
  todo: { label: "A Fazer", color: "var(--ink-faint)" },
  doing: { label: "Em Progresso", color: "var(--amber)" },
  done: { label: "Concluído", color: "var(--teal)" },
};
const ACTIVITY_META = {
  diario: { label: "Diário", bg: "var(--amber-soft)", color: "var(--amber)" },
  ahsd: { label: "AH/SD", bg: "var(--plum-soft)", color: "var(--plum)" },
  kanban: { label: "BI", bg: "var(--teal-soft)", color: "var(--teal)" },
  projeto: { label: "Projeto", bg: "var(--teal-soft)", color: "var(--teal)" },
  evento: { label: "Agenda", bg: "var(--rust-soft)", color: "var(--rust)" },
  niver: { label: "Aniversário", bg: "var(--rust-soft)", color: "var(--rust)" },
};

function refreshDashboard() {
  if (!currentUser) return;

  // ---- Tira de estatísticas ----
  const openTasks = kanbanItems.filter((i) => i.status !== "done").length;
  const activeProjects = projectItems.filter((i) => i.status !== "Concluido").length;
  const nextBirthday = upcomingBirthdays(1)[0];
  const stats = [
    { value: diaryItems.length, label: "Anotações no diário" },
    { value: ahsdItems.length, label: "Registros AH/SD" },
    { value: openTasks, label: "Demandas em aberto" },
    { value: activeProjects, label: "Projetos ativos" },
    { value: nextBirthday ? (nextBirthday.isToday ? "Hoje" : `${nextBirthday.daysLeft}d`) : "—", label: nextBirthday ? `Aniversário: ${nextBirthday.name}` : "Próximo aniversário" },
  ];
  $("#dash-stats").innerHTML = stats.map((s) => `
    <div class="stat-chip">
      <div class="stat-chip-value">${s.value}</div>
      <div class="stat-chip-label">${escapeHtml(s.label)}</div>
    </div>
  `).join("");

  // ---- Próximos compromissos ----
  const nextEvents = upcomingEvents().slice(0, 5);
  $("#dash-events-empty").classList.toggle("hidden", nextEvents.length > 0);
  $("#dash-events-list").innerHTML = nextEvents.map((item) => `
    <div class="list-item">
      <div class="list-item-main">
        <span class="list-item-title">${escapeHtml(item.title)}</span>
        <span class="list-item-date">${fmtDate(new Date(item.date + "T00:00:00"))}</span>
      </div>
    </div>
  `).join("");

  // ---- Aniversários próximos ----
  const nextBirthdays = upcomingBirthdays(5);
  $("#dash-birthdays-empty").classList.toggle("hidden", nextBirthdays.length > 0);
  $("#dash-birthdays-list").innerHTML = nextBirthdays.map((item) => `
    <div class="list-item">
      <div class="list-item-main">
        <span class="list-item-title">${escapeHtml(item.name)}</span>
        <span class="list-item-date">${fmtDayMonth(item.day, item.month)}</span>
      </div>
      <span class="badge badge-status">${item.isToday ? "Hoje 🎉" : `${item.daysLeft}d`}</span>
    </div>
  `).join("");

  // ---- Aro de progresso médio dos projetos ativos ----
  const active = projectItems.filter((i) => i.status !== "Concluido");
  const avg = active.length ? Math.round(active.reduce((sum, i) => sum + (i.progress || 0), 0) / active.length) : 0;
  const deg = Math.round(avg * 3.6);
  $("#dash-ring-wrap").innerHTML = `
    <div class="ring-outer" style="background:conic-gradient(var(--primary-2) ${deg}deg, var(--surface-strong) ${deg}deg)">
      <div class="ring-inner"><span class="ring-inner-value">${avg}%</span></div>
    </div>
  `;
  $("#dash-ring-caption").textContent = active.length ? `${active.length} projeto(s) em andamento` : "Nenhum projeto ativo";

  // ---- Resumo do Kanban ----
  const total = kanbanItems.length || 1;
  $("#dash-kanban-summary").innerHTML = ["todo", "doing", "done"].map((status) => {
    const count = kanbanItems.filter((i) => (i.status || "todo") === status).length;
    const pct = Math.round((count / total) * 100);
    const meta = KANBAN_META[status];
    return `
      <div class="kanban-mini-row">
        <span class="kanban-mini-dot" style="background:${meta.color}"></span>
        <span style="width:88px;flex-shrink:0;">${meta.label}</span>
        <span class="kanban-mini-track"><span class="kanban-mini-fill" style="width:${pct}%; background:${meta.color}"></span></span>
        <span class="kanban-mini-count">${count}</span>
      </div>
    `;
  }).join("");

  // ---- Prazos próximos (projetos + eventos) ----
  const todayStr = new Date().toISOString().slice(0, 10);
  const projectDeadlines = projectItems
    .filter((i) => i.deadline && i.status !== "Concluido")
    .map((i) => ({ title: i.title, date: i.deadline, overdue: i.deadline < todayStr, kind: "Projeto" }));
  const eventDeadlines = upcomingEvents().map((i) => ({ title: i.title, date: i.date, overdue: false, kind: "Evento" }));
  const deadlines = [...projectDeadlines, ...eventDeadlines].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);

  $("#dash-deadlines-empty").classList.toggle("hidden", deadlines.length > 0);
  $("#dash-deadlines-list").innerHTML = deadlines.map((item) => `
    <div class="list-item">
      <div class="list-item-main">
        <span class="list-item-title">${escapeHtml(item.title)}</span>
        <span class="list-item-date">${item.kind} · ${fmtDate(new Date(item.date + "T00:00:00"))}</span>
      </div>
      ${item.overdue ? `<span class="badge badge-overdue">Atrasado</span>` : ""}
    </div>
  `).join("");

  // ---- Atividade recente ----
  const activity = [
    ...diaryItems.map((i) => ({ type: "diario", title: i.title, ts: tsToDate(i.updatedAt) || tsToDate(i.createdAt) })),
    ...ahsdItems.map((i) => ({ type: "ahsd", title: i.content.slice(0, 40), ts: tsToDate(i.updatedAt) || tsToDate(i.createdAt) })),
    ...kanbanItems.map((i) => ({ type: "kanban", title: i.title, ts: tsToDate(i.updatedAt) || tsToDate(i.createdAt) })),
    ...projectItems.map((i) => ({ type: "projeto", title: i.title, ts: tsToDate(i.updatedAt) || tsToDate(i.createdAt) })),
    ...eventItems.map((i) => ({ type: "evento", title: i.title, ts: tsToDate(i.updatedAt) || tsToDate(i.createdAt) })),
    ...birthdayItems.map((i) => ({ type: "niver", title: i.name, ts: tsToDate(i.updatedAt) || tsToDate(i.createdAt) })),
  ].filter((i) => i.ts).sort((a, b) => b.ts - a.ts).slice(0, 8);

  $("#dash-activity-empty").classList.toggle("hidden", activity.length > 0);
  $("#dash-activity-list").innerHTML = activity.map((item) => {
    const meta = ACTIVITY_META[item.type];
    return `
      <div class="activity-row">
        <span class="activity-tag" style="background:${meta.bg}; color:${meta.color};">${meta.label}</span>
        <span class="activity-text">${escapeHtml(item.title)}</span>
        <span class="activity-time">${relativeTime(item.ts)}</span>
      </div>
    `;
  }).join("");
}