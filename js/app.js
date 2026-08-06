// =========================================================
// js/app.js — Nova: Painel Pessoal e de Trabalho
// Vanilla JS (ES6+) + Firebase v10 (modular SDK)
// =========================================================
import { auth, db, googleProvider } from "./firebase-config.js";
import { uploadFileToCloudinary } from "./cloudinary-config.js";
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
   Toasts — feedback visual de sucesso/erro
--------------------------------------------------------- */
const toastContainer = $("#toast-container");
function showToast(message, type = "success") {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add("toast-hide");
    setTimeout(() => el.remove(), 250);
  }, 2800);
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
const goalsApi = makeCollectionApi("goals");
const habitsApi = makeCollectionApi("habits");

function startAllModules(uid) {
  diaryApi.subscribe(uid, renderDiary);
  ahsdApi.subscribe(uid, renderAhsd);
  kanbanApi.subscribe(uid, renderKanban);
  projectsApi.subscribe(uid, renderProjects);
  eventsApi.subscribe(uid, renderEvents);
  birthdaysApi.subscribe(uid, renderBirthdays);
  goalsApi.subscribe(uid, renderGoals);
  habitsApi.subscribe(uid, renderHabits);
}

/* =========================================================
   MÓDULO 1 — Diário & Ideias Literárias
========================================================= */
let diaryItems = [];
const diaryForm = $("#diario-form-wrap");
const diaryAttachmentsFile = $("#diario-attachments-file");
const diaryAttachmentsStatus = $("#diario-attachments-status");
const diaryAttachmentsList = $("#diario-attachments-list");
let diaryAttachmentsDraft = []; // [{url, name, format, resourceType, bytes}]

function fileIconSvg() {
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v5a1 1 0 0 0 1 1h5"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/></svg>`;
}

function renderAttachmentsDraft() {
  diaryAttachmentsList.innerHTML = diaryAttachmentsDraft.map((att, idx) => `
    <span class="attachment-chip">
      ${att.resourceType === "image"
        ? `<img class="attachment-thumb-mini" src="${att.url}" alt="">`
        : `<span class="attachment-icon">${fileIconSvg()}</span>`}
      <span class="attachment-name" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</span>
      <button type="button" class="attachment-remove" data-idx="${idx}" title="Remover anexo" aria-label="Remover anexo">×</button>
    </span>
  `).join("");
  $$(".attachment-remove", diaryAttachmentsList).forEach((btn) => btn.addEventListener("click", () => {
    diaryAttachmentsDraft.splice(Number(btn.dataset.idx), 1);
    renderAttachmentsDraft();
  }));
}

diaryAttachmentsFile.addEventListener("change", async () => {
  const files = Array.from(diaryAttachmentsFile.files || []);
  if (!files.length) return;
  diaryAttachmentsStatus.textContent = files.length > 1 ? `Enviando ${files.length} arquivos…` : "Enviando arquivo…";
  for (const file of files) {
    try {
      const result = await uploadFileToCloudinary(file);
      diaryAttachmentsDraft.push(result);
      renderAttachmentsDraft();
    } catch (err) {
      console.error(err);
      showToast(err.message || `Não foi possível enviar "${file.name}".`, "error");
    }
  }
  diaryAttachmentsStatus.textContent = "Envio concluído ✓";
  diaryAttachmentsFile.value = "";
  setTimeout(() => { diaryAttachmentsStatus.textContent = ""; }, 2500);
});

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
  diaryAttachmentsDraft = [];
  diaryAttachmentsStatus.textContent = "";
  renderAttachmentsDraft();
  diaryForm.classList.remove("hidden");
});
$("#diario-cancel-btn").addEventListener("click", () => diaryForm.classList.add("hidden"));

$("#diario-save-btn").addEventListener("click", async () => {
  const title = $("#diario-title").value.trim();
  const content = $("#diario-content").value.trim();
  if (!title || !content) return showToast("Preencha título e conteúdo.", "error");
  const tags = $("#diario-tags").value.split(",").map((t) => t.trim()).filter(Boolean);
  const payload = {
    title,
    content,
    category: $("#diario-category").value,
    book: $("#diario-book").value.trim(),
    status: $("#diario-status").value,
    tags,
    attachments: diaryAttachmentsDraft,
  };
  const editId = $("#diario-edit-id").value;
  try {
    if (editId) await diaryApi.update(editId, payload);
    else await diaryApi.add(currentUser.uid, payload);
    diaryForm.classList.add("hidden");
    showToast(editId ? "Anotação atualizada." : "Anotação salva.");
  } catch (err) {
    console.error(err);
    showToast("Não foi possível salvar. Tente novamente.", "error");
  }
});

$("#diario-search").addEventListener("input", () => renderDiary());
$("#diario-filter-cat").addEventListener("change", () => renderDiary());
$("#diario-filter-book").addEventListener("change", () => renderDiary());

function openDiaryEntry(id) {
  const item = diaryItems.find((i) => i.id === id);
  if (!item) return;
  switchView("diario");
  $("#diario-edit-id").value = item.id;
  $("#diario-title").value = item.title;
  $("#diario-book").value = item.book || "";
  $("#diario-status").value = item.status || "Rascunho";
  $("#diario-category").value = item.category;
  $("#diario-tags").value = (item.tags || []).join(", ");
  $("#diario-content").value = item.content;
  diaryAttachmentsDraft = [...(item.attachments || [])];
  diaryAttachmentsStatus.textContent = "";
  renderAttachmentsDraft();
  diaryForm.classList.remove("hidden");
}

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
  $("#diario-list").innerHTML = filtered.map((item) => {
    const atts = item.attachments || [];
    const images = atts.filter((a) => a.resourceType === "image");
    const files = atts.filter((a) => a.resourceType !== "image");
    return `
    <article class="entry-card">
      <div class="entry-card-top">
        <span class="entry-tag" style="background:var(--amber-soft); color:var(--amber);">${escapeHtml(item.category)}</span>
        <span class="badge badge-status">${escapeHtml(item.status || "Rascunho")}</span>
      </div>
      <h3 class="entry-title">${escapeHtml(item.title)}</h3>
      ${item.book ? `<p class="entry-meta"><span>📖 ${escapeHtml(item.book)}</span></p>` : ""}
      <div class="entry-body">${mdToHtml(item.content)}</div>
      ${images.length ? `<div class="entry-gallery">${images.map((img) => `<a href="${img.url}" target="_blank" rel="noopener"><img src="${img.url}" alt="${escapeHtml(img.name)}" loading="lazy"></a>`).join("")}</div>` : ""}
      ${files.length ? `<div class="entry-files">${files.map((f) => `<a class="entry-file-chip" href="${f.url}" target="_blank" rel="noopener">${fileIconSvg()} ${escapeHtml(f.name)}</a>`).join("")}</div>` : ""}
      ${(item.tags || []).length ? `<div class="entry-tags">${item.tags.map((t) => `<span class="tag-chip">#${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      <div class="entry-actions">
        <button data-action="edit" data-id="${item.id}">Editar</button>
        <button data-action="delete" data-id="${item.id}">Excluir</button>
      </div>
    </article>
  `;
  }).join("");

  $$('#diario-list [data-action="edit"]').forEach((btn) => btn.addEventListener("click", () => openDiaryEntry(btn.dataset.id)));
  $$('#diario-list [data-action="delete"]').forEach((btn) => btn.addEventListener("click", () => {
    if (confirm("Excluir esta anotação?")) { diaryApi.remove(btn.dataset.id); showToast("Anotação excluída."); }
  }));

  refreshDashboard();
}

/* =========================================================
   MÓDULO 2 — Avaliação AH/SD
========================================================= */
let ahsdItems = [];
const ahsdForm = $("#ahsd-form-wrap");

const AHSD_TAGS = [
  "Hiperfoco", "Criatividade", "Sensibilidade", "Sobrecarga", "Comunicação",
  "Rigidez", "Máscara Social", "Memória", "Ansiedade", "Interesse específico",
  "Organização", "Socialização",
];
let ahsdTagsDraft = [];
let ahsdActiveTagFilter = null;

function renderAhsdTagToggles() {
  $("#ahsd-tag-toggle-group").innerHTML = AHSD_TAGS.map((tag) => `
    <button type="button" class="tag-toggle ${ahsdTagsDraft.includes(tag) ? "active" : ""}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>
  `).join("");
  $$(".tag-toggle", $("#ahsd-tag-toggle-group")).forEach((btn) => btn.addEventListener("click", () => {
    const tag = btn.dataset.tag;
    if (ahsdTagsDraft.includes(tag)) ahsdTagsDraft = ahsdTagsDraft.filter((t) => t !== tag);
    else ahsdTagsDraft.push(tag);
    renderAhsdTagToggles();
  }));
}

function nowForDatetimeLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

$("#ahsd-new-btn").addEventListener("click", () => {
  $("#ahsd-edit-id").value = "";
  $("#ahsd-datetime").value = nowForDatetimeLocal();
  $("#ahsd-content").value = "";
  ahsdTagsDraft = [];
  renderAhsdTagToggles();
  ahsdForm.classList.remove("hidden");
});
$("#ahsd-cancel-btn").addEventListener("click", () => ahsdForm.classList.add("hidden"));

$("#ahsd-save-btn").addEventListener("click", async () => {
  const content = $("#ahsd-content").value.trim();
  const dateTime = $("#ahsd-datetime").value;
  if (!content || !dateTime) return showToast("Preencha data/hora e observação.", "error");
  const payload = { content, dateTime, tags: ahsdTagsDraft };
  const editId = $("#ahsd-edit-id").value;
  try {
    if (editId) await ahsdApi.update(editId, payload);
    else await ahsdApi.add(currentUser.uid, payload);
    ahsdForm.classList.add("hidden");
    showToast(editId ? "Registro atualizado." : "Registro salvo.");
  } catch (err) {
    console.error(err);
    showToast("Não foi possível salvar. Tente novamente.", "error");
  }
});

$("#ahsd-search").addEventListener("input", () => renderAhsd());
$("#ahsd-tag-clear-btn").addEventListener("click", () => {
  ahsdActiveTagFilter = null;
  renderAhsd();
});

function openAhsdEntry(id) {
  const item = ahsdItems.find((i) => i.id === id);
  if (!item) return;
  switchView("ahsd");
  $("#ahsd-edit-id").value = item.id;
  $("#ahsd-datetime").value = item.dateTime;
  $("#ahsd-content").value = item.content;
  ahsdTagsDraft = [...(item.tags || [])];
  renderAhsdTagToggles();
  ahsdForm.classList.remove("hidden");
}

function renderAhsdTagFrequency() {
  const counts = {};
  AHSD_TAGS.forEach((t) => { counts[t] = 0; });
  ahsdItems.forEach((item) => (item.tags || []).forEach((t) => { if (counts[t] !== undefined) counts[t]++; }));
  const max = Math.max(1, ...Object.values(counts));
  const sortedTags = [...AHSD_TAGS].sort((a, b) => counts[b] - counts[a]).filter((t) => counts[t] > 0);

  $("#ahsd-tag-clear-btn").classList.toggle("hidden", !ahsdActiveTagFilter);

  if (!sortedTags.length) {
    $("#ahsd-tag-freq-list").innerHTML = `<p class="empty-state small">Adicione marcadores aos registros para ver os padrões mais frequentes aqui.</p>`;
    return;
  }
  $("#ahsd-tag-freq-list").innerHTML = sortedTags.map((tag) => `
    <div class="tag-freq-row ${ahsdActiveTagFilter === tag ? "active" : ""}" data-tag="${escapeHtml(tag)}">
      <span class="tag-freq-name">${escapeHtml(tag)}</span>
      <span class="tag-freq-track"><span class="tag-freq-fill" style="width:${(counts[tag] / max) * 100}%"></span></span>
      <span class="tag-freq-count">${counts[tag]}</span>
    </div>
  `).join("");
  $$(".tag-freq-row", $("#ahsd-tag-freq-list")).forEach((row) => row.addEventListener("click", () => {
    const tag = row.dataset.tag;
    ahsdActiveTagFilter = ahsdActiveTagFilter === tag ? null : tag;
    renderAhsd();
  }));
}

function renderAhsd(items) {
  if (items) ahsdItems = items;
  renderAhsdTagFrequency();
  const search = $("#ahsd-search").value.toLowerCase();
  const filtered = ahsdItems
    .filter((i) => !search || i.content.toLowerCase().includes(search))
    .filter((i) => !ahsdActiveTagFilter || (i.tags || []).includes(ahsdActiveTagFilter))
    .sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

  $("#ahsd-empty").classList.toggle("hidden", filtered.length > 0);
  $("#ahsd-list").innerHTML = filtered.map((item) => `
    <div class="timeline-item">
      <div class="timeline-date">${fmtDateTime(new Date(item.dateTime))}</div>
      <p class="timeline-text">${escapeHtml(item.content)}</p>
      ${(item.tags || []).length ? `<div class="timeline-tags">${item.tags.map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      <div class="timeline-actions">
        <button data-action="edit" data-id="${item.id}">Editar</button>
        <button data-action="delete" data-id="${item.id}">Excluir</button>
      </div>
    </div>
  `).join("");

  $$('#ahsd-list [data-action="edit"]').forEach((btn) => btn.addEventListener("click", () => openAhsdEntry(btn.dataset.id)));
  $$('#ahsd-list [data-action="delete"]').forEach((btn) => btn.addEventListener("click", () => {
    if (confirm("Excluir este registro?")) { ahsdApi.remove(btn.dataset.id); showToast("Registro excluído."); }
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
  if (!title) return showToast("Informe um título para a demanda.", "error");
  const payload = { title, description: $("#kanban-desc").value.trim() };
  const editId = $("#kanban-edit-id").value;
  try {
    if (editId) await kanbanApi.update(editId, payload);
    else await kanbanApi.add(currentUser.uid, { ...payload, status: "todo" });
    kanbanForm.classList.add("hidden");
    showToast(editId ? "Demanda atualizada." : "Demanda criada.");
  } catch (err) {
    console.error(err);
    showToast("Não foi possível salvar. Tente novamente.", "error");
  }
});

function openKanbanTask(id) {
  const item = kanbanItems.find((i) => i.id === id);
  if (!item) return;
  switchView("kanban");
  $("#kanban-edit-id").value = item.id;
  $("#kanban-title").value = item.title;
  $("#kanban-desc").value = item.description || "";
  kanbanForm.classList.remove("hidden");
}

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
    openKanbanTask(btn.dataset.id);
  }));
  $$('.kanban-card [data-action="delete"]').forEach((btn) => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (confirm("Excluir esta demanda?")) { kanbanApi.remove(btn.dataset.id); showToast("Demanda excluída."); }
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
  if (!title) return showToast("Informe o nome do projeto.", "error");
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
    showToast(editId ? "Projeto atualizado." : "Projeto criado.");
  } catch (err) {
    console.error(err);
    showToast("Não foi possível salvar. Tente novamente.", "error");
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
    showToast("Progresso atualizado.");
  } catch (err) {
    console.error(err);
    showToast("Não foi possível registrar a atualização. Tente novamente.", "error");
  }
}

function openProjectEntry(id) {
  const item = projectItems.find((i) => i.id === id);
  if (!item) return;
  switchView("projetos");
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
  $$('#projeto-list [data-action="edit"]').forEach((btn) => btn.addEventListener("click", () => openProjectEntry(btn.dataset.id)));
  $$('#projeto-list [data-action="delete"]').forEach((btn) => btn.addEventListener("click", () => {
    if (confirm("Excluir este projeto?")) { projectsApi.remove(btn.dataset.id); showToast("Projeto excluído."); }
  }));

  refreshDashboard();
}

/* =========================================================
   MÓDULO 4.1 — Metas
========================================================= */
let goalItems = [];
const metaForm = $("#meta-form-wrap");
let metaLinkProjects = [];
let metaLinkTasks = [];
let metaLinkHabits = [];

const GOAL_STATUS_LABEL = { "Nao iniciada": "Não iniciada", "Em andamento": "Em andamento", "Pausada": "Pausada", "Concluida": "Concluída" };

function renderMetaProjectToggles() {
  $("#meta-link-projects").innerHTML = projectItems.length
    ? projectItems.map((p) => `<button type="button" class="tag-toggle ${metaLinkProjects.includes(p.id) ? "active" : ""}" data-id="${p.id}">${escapeHtml(p.title)}</button>`).join("")
    : `<p class="empty-state small">Nenhum projeto cadastrado ainda.</p>`;
  $$(".tag-toggle", $("#meta-link-projects")).forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.dataset.id;
    metaLinkProjects = metaLinkProjects.includes(id) ? metaLinkProjects.filter((x) => x !== id) : [...metaLinkProjects, id];
    renderMetaProjectToggles();
  }));
}
function renderMetaTaskToggles() {
  $("#meta-link-tasks").innerHTML = kanbanItems.length
    ? kanbanItems.map((t) => `<button type="button" class="tag-toggle ${metaLinkTasks.includes(t.id) ? "active" : ""}" data-id="${t.id}">${escapeHtml(t.title)}</button>`).join("")
    : `<p class="empty-state small">Nenhuma demanda cadastrada ainda.</p>`;
  $$(".tag-toggle", $("#meta-link-tasks")).forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.dataset.id;
    metaLinkTasks = metaLinkTasks.includes(id) ? metaLinkTasks.filter((x) => x !== id) : [...metaLinkTasks, id];
    renderMetaTaskToggles();
  }));
}
function renderMetaHabitToggles() {
  $("#meta-link-habits").innerHTML = habitItems.length
    ? habitItems.map((h) => `<button type="button" class="tag-toggle ${metaLinkHabits.includes(h.id) ? "active" : ""}" data-id="${h.id}">${escapeHtml(h.emoji || "🔁")} ${escapeHtml(h.title)}</button>`).join("")
    : `<p class="empty-state small">Nenhum hábito cadastrado ainda.</p>`;
  $$(".tag-toggle", $("#meta-link-habits")).forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.dataset.id;
    metaLinkHabits = metaLinkHabits.includes(id) ? metaLinkHabits.filter((x) => x !== id) : [...metaLinkHabits, id];
    renderMetaHabitToggles();
  }));
}

function buildSparkline(log) {
  if (!log || log.length < 2) return "";
  const w = 220, h = 34, pad = 3;
  const points = log.map((entry, idx) => {
    const x = pad + (idx / (log.length - 1)) * (w - pad * 2);
    const y = h - pad - (Math.max(0, Math.min(100, entry.percent)) / 100) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<svg class="goal-sparkline" width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="var(--teal)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

$("#meta-new-btn").addEventListener("click", () => {
  $("#meta-edit-id").value = "";
  $("#meta-title").value = "";
  $("#meta-category").value = "Pessoal";
  $("#meta-priority").value = "Media";
  $("#meta-status").value = "Nao iniciada";
  $("#meta-deadline").value = "";
  $("#meta-desc").value = "";
  $("#meta-progress").value = 0;
  $("#meta-progress-value").textContent = 0;
  metaLinkProjects = []; metaLinkTasks = []; metaLinkHabits = [];
  renderMetaProjectToggles(); renderMetaTaskToggles(); renderMetaHabitToggles();
  metaForm.classList.remove("hidden");
});
$("#meta-cancel-btn").addEventListener("click", () => metaForm.classList.add("hidden"));
$("#meta-progress").addEventListener("input", (e) => { $("#meta-progress-value").textContent = e.target.value; });
$("#meta-filter-status").addEventListener("change", () => renderGoals());
$("#meta-search").addEventListener("input", () => renderGoals());

$("#meta-save-btn").addEventListener("click", async () => {
  const title = $("#meta-title").value.trim();
  if (!title) return showToast("Informe o título da meta.", "error");
  const newProgress = Number($("#meta-progress").value);
  const editId = $("#meta-edit-id").value;
  const existing = editId ? goalItems.find((i) => i.id === editId) : null;
  const existingLog = existing?.progressLog || [];
  const payload = {
    title,
    category: $("#meta-category").value,
    priority: $("#meta-priority").value,
    status: $("#meta-status").value,
    deadline: $("#meta-deadline").value || null,
    description: $("#meta-desc").value.trim(),
    progress: newProgress,
    linkedProjectIds: metaLinkProjects,
    linkedTaskIds: metaLinkTasks,
    linkedHabitIds: metaLinkHabits,
  };
  if (!existing || existing.progress !== newProgress) {
    payload.progressLog = [...existingLog, { date: new Date().toISOString(), percent: newProgress, note: existing ? "Atualizado pelo formulário" : "Criação da meta" }];
  }
  try {
    if (editId) await goalsApi.update(editId, payload);
    else await goalsApi.add(currentUser.uid, payload);
    metaForm.classList.add("hidden");
    showToast(editId ? "Meta atualizada." : "Meta criada.");
  } catch (err) {
    console.error(err);
    showToast("Não foi possível salvar. Tente novamente.", "error");
  }
});

async function quickUpdateGoalProgress(id, percent, note) {
  const item = goalItems.find((i) => i.id === id);
  if (!item) return;
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  const log = [...(item.progressLog || []), { date: new Date().toISOString(), percent: clamped, note: note?.trim() || "" }];
  try {
    await goalsApi.update(id, { progress: clamped, progressLog: log });
    showToast("Progresso atualizado.");
  } catch (err) {
    console.error(err);
    showToast("Não foi possível registrar a atualização.", "error");
  }
}

function openGoalEntry(id) {
  const item = goalItems.find((i) => i.id === id);
  if (!item) return;
  switchView("metas");
  $("#meta-edit-id").value = item.id;
  $("#meta-title").value = item.title;
  $("#meta-category").value = item.category || "Pessoal";
  $("#meta-priority").value = item.priority || "Media";
  $("#meta-status").value = item.status || "Nao iniciada";
  $("#meta-deadline").value = item.deadline || "";
  $("#meta-desc").value = item.description || "";
  $("#meta-progress").value = item.progress || 0;
  $("#meta-progress-value").textContent = item.progress || 0;
  metaLinkProjects = [...(item.linkedProjectIds || [])];
  metaLinkTasks = [...(item.linkedTaskIds || [])];
  metaLinkHabits = [...(item.linkedHabitIds || [])];
  renderMetaProjectToggles(); renderMetaTaskToggles(); renderMetaHabitToggles();
  metaForm.classList.remove("hidden");
}

function renderGoals(items) {
  if (items) goalItems = items;
  const search = $("#meta-search").value.toLowerCase();
  const statusFilter = $("#meta-filter-status").value;
  const sorted = [...goalItems]
    .filter((i) => !statusFilter || i.status === statusFilter)
    .filter((i) => !search || i.title.toLowerCase().includes(search) || (i.description || "").toLowerCase().includes(search))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  $("#meta-empty").classList.toggle("hidden", sorted.length > 0);
  $("#meta-list").innerHTML = sorted.map((item) => {
    const priorityClass = PRIORITY_BADGE[item.priority] || "badge-media";
    const linkedProjects = (item.linkedProjectIds || []).map((id) => projectItems.find((p) => p.id === id)).filter(Boolean);
    const linkedTasks = (item.linkedTaskIds || []).map((id) => kanbanItems.find((p) => p.id === id)).filter(Boolean);
    const linkedHabits = (item.linkedHabitIds || []).map((id) => habitItems.find((p) => p.id === id)).filter(Boolean);
    const linksHtml = [
      ...linkedProjects.map((p) => `<span class="linked-chip" data-type="projeto" data-id="${p.id}">📁 ${escapeHtml(p.title)}</span>`),
      ...linkedTasks.map((t) => `<span class="linked-chip" data-type="kanban" data-id="${t.id}">🗂️ ${escapeHtml(t.title)}</span>`),
      ...linkedHabits.map((h) => `<span class="linked-chip" data-type="habito" data-id="${h.id}">${escapeHtml(h.emoji || "🔁")} ${escapeHtml(h.title)}</span>`),
    ].join("");
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
        <span class="badge badge-status">${GOAL_STATUS_LABEL[item.status] || item.status}</span>
      </div>
      <h3 class="entry-title">${escapeHtml(item.title)}</h3>
      ${item.description ? `<p class="entry-body">${escapeHtml(item.description)}</p>` : ""}
      ${item.deadline ? `<div class="entry-meta"><span>Prazo: ${fmtDate(new Date(item.deadline + "T00:00:00"))}</span></div>` : ""}
      <div class="progress-bar"><div class="progress-fill" style="width:${item.progress || 0}%"></div></div>
      <span class="progress-value">${item.progress || 0}% concluído</span>
      ${buildSparkline(log)}
      ${linksHtml ? `<div class="linked-chips">${linksHtml}</div>` : ""}

      <div class="progress-log">
        <button type="button" class="progress-log-toggle" data-action="toggle-log" data-id="${item.id}">
          Histórico ${log.length ? `(${log.length})` : ""} ▾
        </button>
        <div class="progress-log-panel hidden" id="goal-log-panel-${item.id}">
          ${logEntriesHtml ? `<div class="progress-log-entries">${logEntriesHtml}</div>` : `<p class="empty-state small">Nenhuma atualização registrada ainda.</p>`}
          <div class="progress-log-form">
            <div class="form-row form-row-2">
              <label class="field-label">Novo progresso (%)
                <input type="number" min="0" max="100" class="input mono" id="goal-quick-progress-${item.id}" value="${item.progress || 0}" />
              </label>
              <label class="field-label">Observação (opcional)
                <input type="text" class="input" id="goal-quick-note-${item.id}" placeholder="O que mudou?" />
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

  $$('#meta-list [data-action="toggle-log"]').forEach((btn) => btn.addEventListener("click", () => {
    $(`#goal-log-panel-${btn.dataset.id}`).classList.toggle("hidden");
  }));
  $$('#meta-list [data-action="quick-update"]').forEach((btn) => btn.addEventListener("click", async () => {
    const id = btn.dataset.id;
    const percent = $(`#goal-quick-progress-${id}`).value;
    const note = $(`#goal-quick-note-${id}`).value;
    await quickUpdateGoalProgress(id, percent, note);
  }));
  $$('#meta-list [data-action="edit"]').forEach((btn) => btn.addEventListener("click", () => openGoalEntry(btn.dataset.id)));
  $$('#meta-list [data-action="delete"]').forEach((btn) => btn.addEventListener("click", () => {
    if (confirm("Excluir esta meta?")) { goalsApi.remove(btn.dataset.id); showToast("Meta excluída."); }
  }));
  $$("#meta-list .linked-chip").forEach((chip) => chip.addEventListener("click", () => openActivityItem(chip.dataset.type, chip.dataset.id)));

  refreshDashboard();
}

/* =========================================================
   MÓDULO 4.2 — Hábitos
========================================================= */
let habitItems = [];
const habitoForm = $("#habito-form-wrap");
const HABIT_FREQ_LABEL = { diario: "Diário", semanal: "Semanal", mensal: "Mensal" };

function updateHabitTargetVisibility() {
  const freq = $("#habito-frequency").value;
  const wrap = $("#habito-target-wrap");
  if (freq === "diario") {
    wrap.classList.add("hidden");
  } else {
    wrap.classList.remove("hidden");
    $("#habito-target-label").textContent = freq === "semanal" ? "Quantas vezes por semana" : "Quantas vezes por mês";
  }
}
$("#habito-frequency").addEventListener("change", updateHabitTargetVisibility);

$("#habito-new-btn").addEventListener("click", () => {
  $("#habito-edit-id").value = "";
  $("#habito-title").value = "";
  $("#habito-emoji").value = "";
  $("#habito-frequency").value = "diario";
  $("#habito-target").value = 3;
  $("#habito-notes").value = "";
  updateHabitTargetVisibility();
  habitoForm.classList.remove("hidden");
});
$("#habito-cancel-btn").addEventListener("click", () => habitoForm.classList.add("hidden"));

$("#habito-save-btn").addEventListener("click", async () => {
  const title = $("#habito-title").value.trim();
  if (!title) return showToast("Informe o nome do hábito.", "error");
  const frequency = $("#habito-frequency").value;
  const payload = {
    title,
    emoji: $("#habito-emoji").value.trim() || "🔁",
    frequency,
    target: frequency === "diario" ? 1 : (Number($("#habito-target").value) || 1),
    notes: $("#habito-notes").value.trim(),
  };
  const editId = $("#habito-edit-id").value;
  try {
    if (editId) await habitsApi.update(editId, payload);
    else await habitsApi.add(currentUser.uid, { ...payload, completions: [] });
    habitoForm.classList.add("hidden");
    showToast(editId ? "Hábito atualizado." : "Hábito criado.");
  } catch (err) {
    console.error(err);
    showToast("Não foi possível salvar. Tente novamente.", "error");
  }
});

function openHabitEntry(id) {
  const item = habitItems.find((i) => i.id === id);
  if (!item) return;
  switchView("habitos");
  $("#habito-edit-id").value = item.id;
  $("#habito-title").value = item.title;
  $("#habito-emoji").value = item.emoji || "";
  $("#habito-frequency").value = item.frequency || "diario";
  $("#habito-target").value = item.target || 3;
  $("#habito-notes").value = item.notes || "";
  updateHabitTargetVisibility();
  habitoForm.classList.remove("hidden");
}

async function toggleHabitCompletion(id, dateStr) {
  const item = habitItems.find((i) => i.id === id);
  if (!item) return;
  const completions = item.completions || [];
  const next = completions.includes(dateStr) ? completions.filter((d) => d !== dateStr) : [...completions, dateStr];
  try {
    await habitsApi.update(id, { completions: next });
  } catch (err) {
    console.error(err);
    showToast("Não foi possível registrar. Tente novamente.", "error");
  }
}

function getWeekKey(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return ymd(d.getFullYear(), d.getMonth(), d.getDate());
}
function getMonthKey(date) { return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`; }
function stepBackPeriod(date, frequency) {
  const d = new Date(date);
  if (frequency === "semanal") d.setDate(d.getDate() - 7);
  else d.setMonth(d.getMonth() - 1);
  return d;
}

function getHabitStreak(habit) {
  const completions = habit.completions || [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (habit.frequency === "diario") {
    let streak = 0;
    const todayStr = ymd(today.getFullYear(), today.getMonth(), today.getDate());
    let cursor = new Date(today);
    if (!completions.includes(todayStr)) cursor.setDate(cursor.getDate() - 1);
    while (completions.includes(ymd(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  const keyFn = habit.frequency === "semanal" ? getWeekKey : getMonthKey;
  const target = habit.target || 1;
  const counts = {};
  completions.forEach((dStr) => {
    const key = keyFn(new Date(dStr + "T00:00:00"));
    counts[key] = (counts[key] || 0) + 1;
  });

  let streak = 0;
  let cursor = new Date(today);
  if ((counts[keyFn(cursor)] || 0) < target) cursor = stepBackPeriod(cursor, habit.frequency);
  for (let i = 0; i < 120; i++) {
    const key = keyFn(cursor);
    if ((counts[key] || 0) >= target) {
      streak++;
      cursor = stepBackPeriod(cursor, habit.frequency);
    } else break;
  }
  return streak;
}

function buildHabitHeatmap(habit, days = 70) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (days - 1));
  const padStart = startDate.getDay();
  const todayStr = ymd(today.getFullYear(), today.getMonth(), today.getDate());

  let cellsHtml = "";
  for (let p = 0; p < padStart; p++) cellsHtml += `<span class="habit-cell empty"></span>`;
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const dateStr = ymd(d.getFullYear(), d.getMonth(), d.getDate());
    const done = (habit.completions || []).includes(dateStr);
    const isToday = dateStr === todayStr;
    const isFuture = d > today;
    cellsHtml += `<span class="habit-cell ${done ? "done" : ""} ${isToday ? "today" : ""} ${isFuture ? "future" : ""}" data-date="${dateStr}" data-id="${habit.id}" title="${dateStr}${done ? " ✓" : ""}"></span>`;
  }
  return cellsHtml;
}

function renderHabits(items) {
  if (items) habitItems = items;
  const sorted = [...habitItems].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  $("#habito-empty").classList.toggle("hidden", sorted.length > 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = ymd(today.getFullYear(), today.getMonth(), today.getDate());

  $("#habito-list").innerHTML = sorted.map((item) => {
    const streak = getHabitStreak(item);
    const doneToday = (item.completions || []).includes(todayStr);
    const streakUnit = item.frequency === "diario" ? "dia(s)" : item.frequency === "semanal" ? "semana(s)" : "mês(es)";
    return `
    <article class="habit-card">
      <div class="habit-card-head">
        <span class="habit-emoji">${escapeHtml(item.emoji || "🔁")}</span>
        <div class="habit-title-wrap">
          <p class="habit-title">${escapeHtml(item.title)}</p>
          <span class="habit-freq-badge">${HABIT_FREQ_LABEL[item.frequency] || item.frequency}${item.frequency !== "diario" ? ` · meta ${item.target}x` : ""}</span>
        </div>
        <span class="habit-streak-badge">🔥 ${streak} ${streakUnit}</span>
      </div>

      <button type="button" class="habit-today-btn ${doneToday ? "done" : ""}" data-action="toggle-today" data-id="${item.id}">
        ${doneToday ? "✓ Feito hoje" : "Marcar hoje"}
      </button>

      <div class="habit-heatmap">${buildHabitHeatmap(item)}</div>

      <div class="habit-stats"><span>Total: <strong>${(item.completions || []).length}</strong> marcação(ões)</span></div>
      ${item.notes ? `<p class="entry-body">${escapeHtml(item.notes)}</p>` : ""}

      <div class="habit-card-actions">
        <button data-action="edit" data-id="${item.id}">Editar</button>
        <button data-action="delete" data-id="${item.id}">Excluir</button>
      </div>
    </article>
  `;
  }).join("");

  $$('#habito-list [data-action="toggle-today"]').forEach((btn) => btn.addEventListener("click", () => toggleHabitCompletion(btn.dataset.id, todayStr)));
  $$(".habit-cell:not(.empty):not(.future)", $("#habito-list")).forEach((cell) => cell.addEventListener("click", () => toggleHabitCompletion(cell.dataset.id, cell.dataset.date)));
  $$('#habito-list [data-action="edit"]').forEach((btn) => btn.addEventListener("click", () => openHabitEntry(btn.dataset.id)));
  $$('#habito-list [data-action="delete"]').forEach((btn) => btn.addEventListener("click", () => {
    if (confirm("Excluir este hábito?")) { habitsApi.remove(btn.dataset.id); showToast("Hábito excluído."); }
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
  if (!title || !date) return showToast("Preencha título e data do evento.", "error");
  const payload = { title, date, notes: $("#evento-notes").value.trim() };
  const editId = $("#evento-edit-id").value;
  try {
    if (editId) await eventsApi.update(editId, payload);
    else await eventsApi.add(currentUser.uid, payload);
    eventoForm.classList.add("hidden");
    showToast(editId ? "Evento atualizado." : "Evento criado.");
  } catch (err) {
    console.error(err);
    showToast("Não foi possível salvar. Tente novamente.", "error");
  }
});

function upcomingEvents() {
  const todayStr = new Date().toISOString().slice(0, 10);
  return eventItems.filter((i) => i.date >= todayStr).sort((a, b) => a.date.localeCompare(b.date));
}

function openEventEntry(id) {
  const item = eventItems.find((i) => i.id === id);
  if (!item) return;
  switchView("agenda");
  $("#evento-edit-id").value = item.id;
  $("#evento-title").value = item.title;
  $("#evento-date").value = item.date;
  $("#evento-notes").value = item.notes || "";
  eventoForm.classList.remove("hidden");
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

  $$('#evento-list [data-action="edit"]').forEach((btn) => btn.addEventListener("click", () => openEventEntry(btn.dataset.id)));
  $$('#evento-list [data-action="delete"]').forEach((btn) => btn.addEventListener("click", () => {
    if (confirm("Excluir este evento?")) { eventsApi.remove(btn.dataset.id); showToast("Evento excluído."); }
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
  if (!name || !day || !month) return showToast("Preencha nome, dia e mês.", "error");
  const payload = { name, day, month };
  const editId = $("#niver-edit-id").value;
  try {
    if (editId) await birthdaysApi.update(editId, payload);
    else await birthdaysApi.add(currentUser.uid, payload);
    niverForm.classList.add("hidden");
    showToast(editId ? "Aniversário atualizado." : "Aniversário salvo.");
  } catch (err) {
    console.error(err);
    showToast("Não foi possível salvar. Tente novamente.", "error");
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

function openBirthdayEntry(id) {
  const item = birthdayItems.find((i) => i.id === id);
  if (!item) return;
  switchView("agenda");
  $("#niver-edit-id").value = item.id;
  $("#niver-name").value = item.name;
  $("#niver-day").value = String(item.day);
  $("#niver-month").value = String(item.month);
  niverForm.classList.remove("hidden");
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

  $$('#niver-tbody [data-action="edit"]').forEach((btn) => btn.addEventListener("click", () => openBirthdayEntry(btn.dataset.id)));
  $$('#niver-tbody [data-action="delete"]').forEach((btn) => btn.addEventListener("click", () => {
    if (confirm("Excluir este aniversário?")) { birthdaysApi.remove(btn.dataset.id); showToast("Aniversário excluído."); }
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
  meta: { label: "Meta", bg: "var(--teal-soft)", color: "var(--teal)" },
  habito: { label: "Hábito", bg: "var(--rust-soft)", color: "var(--rust)" },
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

  // ---- Progresso individual, por projeto ----
  const sortedActive = [...active].sort((a, b) => (a.progress || 0) - (b.progress || 0));
  $("#dash-projects-list").innerHTML = sortedActive.length
    ? sortedActive.map((p) => `
        <div class="mini-progress-row">
          <span class="mp-name" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</span>
          <span class="mp-track"><span class="mp-fill" style="width:${p.progress || 0}%"></span></span>
          <span class="mp-pct">${p.progress || 0}%</span>
        </div>
      `).join("")
    : `<p class="empty-state small">Cadastre um projeto para acompanhar o progresso aqui.</p>`;

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

  // ---- Metas em destaque ----
  const todayStr = new Date().toISOString().slice(0, 10);
  const highlightGoals = [...goalItems]
    .filter((g) => g.status !== "Concluida")
    .sort((a, b) => {
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
    })
    .slice(0, 4);
  $("#dash-goals-empty").classList.toggle("hidden", highlightGoals.length > 0);
  $("#dash-goals-list").innerHTML = highlightGoals.map((g) => `
    <div class="mini-progress-row" data-id="${g.id}" style="cursor:pointer;">
      <span class="mp-name" title="${escapeHtml(g.title)}">${escapeHtml(g.title)}</span>
      <span class="mp-track"><span class="mp-fill" style="width:${g.progress || 0}%"></span></span>
      <span class="mp-pct">${g.progress || 0}%</span>
    </div>
  `).join("");
  $$("#dash-goals-list .mini-progress-row").forEach((row) => row.addEventListener("click", () => openGoalEntry(row.dataset.id)));

  // ---- Hábitos de hoje ----
  $("#dash-habits-empty").classList.toggle("hidden", habitItems.length > 0);
  $("#dash-habits-today").innerHTML = habitItems.map((h) => {
    const streak = getHabitStreak(h);
    const streakUnit = h.frequency === "diario" ? "d" : h.frequency === "semanal" ? "sem" : "mês";
    let doneCurrentPeriod;
    if (h.frequency === "diario") {
      doneCurrentPeriod = (h.completions || []).includes(todayStr);
    } else {
      const keyFn = h.frequency === "semanal" ? getWeekKey : getMonthKey;
      const target = h.target || 1;
      const currentKey = keyFn(new Date());
      const count = (h.completions || []).filter((d) => keyFn(new Date(d + "T00:00:00")) === currentKey).length;
      doneCurrentPeriod = count >= target;
    }
    return `
      <div class="habit-today-row ${doneCurrentPeriod ? "done" : ""}" data-id="${h.id}">
        <span class="habit-today-check"></span>
        <span class="habit-today-name">${escapeHtml(h.emoji || "🔁")} ${escapeHtml(h.title)}</span>
        <span class="habit-today-streak">🔥 ${streak}${streakUnit}</span>
      </div>
    `;
  }).join("");
  $$("#dash-habits-today .habit-today-row").forEach((row) => row.addEventListener("click", () => toggleHabitCompletion(row.dataset.id, todayStr)));

  // ---- Prazos próximos (projetos + eventos) ----
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
  const activity = buildActivityFeed({ limit: 8 });
  $("#dash-activity-empty").classList.toggle("hidden", activity.length > 0);
  $("#dash-activity-list").innerHTML = activity.map(renderActivityRow).join("");
  attachActivityClickHandlers("#dash-activity-list");

  renderCalendar();
  renderDailyBrief();
  renderAtividade();
}

/* =========================================================
   ATIVIDADE GERAL — feed cronológico reutilizável (Dashboard + view própria)
========================================================= */
function buildActivityFeed({ limit = null, typeFilter = "", search = "" } = {}) {
  const term = search.toLowerCase();
  let activity = [
    ...diaryItems.map((i) => ({ type: "diario", id: i.id, title: i.title, ts: tsToDate(i.updatedAt) || tsToDate(i.createdAt) })),
    ...ahsdItems.map((i) => ({ type: "ahsd", id: i.id, title: i.content.slice(0, 60), ts: tsToDate(i.updatedAt) || tsToDate(i.createdAt) })),
    ...kanbanItems.map((i) => ({ type: "kanban", id: i.id, title: i.title, ts: tsToDate(i.updatedAt) || tsToDate(i.createdAt) })),
    ...projectItems.map((i) => ({ type: "projeto", id: i.id, title: i.title, ts: tsToDate(i.updatedAt) || tsToDate(i.createdAt) })),
    ...eventItems.map((i) => ({ type: "evento", id: i.id, title: i.title, ts: tsToDate(i.updatedAt) || tsToDate(i.createdAt) })),
    ...birthdayItems.map((i) => ({ type: "niver", id: i.id, title: i.name, ts: tsToDate(i.updatedAt) || tsToDate(i.createdAt) })),
    ...goalItems.map((i) => ({ type: "meta", id: i.id, title: i.title, ts: tsToDate(i.updatedAt) || tsToDate(i.createdAt) })),
    ...habitItems.map((i) => ({ type: "habito", id: i.id, title: i.title, ts: tsToDate(i.updatedAt) || tsToDate(i.createdAt) })),
  ].filter((i) => i.ts);

  if (typeFilter) activity = activity.filter((i) => i.type === typeFilter);
  if (term) activity = activity.filter((i) => i.title.toLowerCase().includes(term));

  activity.sort((a, b) => b.ts - a.ts);
  return limit ? activity.slice(0, limit) : activity;
}

function renderActivityRow(item) {
  const meta = ACTIVITY_META[item.type];
  return `
    <div class="activity-row" data-type="${item.type}" data-id="${item.id}">
      <span class="activity-tag" style="background:${meta.bg}; color:${meta.color};">${meta.label}</span>
      <span class="activity-text">${escapeHtml(item.title)}</span>
      <span class="activity-time">${relativeTime(item.ts)}</span>
    </div>
  `;
}

function attachActivityClickHandlers(containerSelector) {
  $$(`${containerSelector} .activity-row`).forEach((row) => row.addEventListener("click", () => openActivityItem(row.dataset.type, row.dataset.id)));
}

// Dispatcher único: abre o registro correspondente no módulo certo, a partir
// da Atividade Geral, do Dashboard ou da Busca Global.
function openActivityItem(type, id) {
  switch (type) {
    case "diario": openDiaryEntry(id); break;
    case "ahsd": openAhsdEntry(id); break;
    case "kanban": openKanbanTask(id); break;
    case "projeto": openProjectEntry(id); break;
    case "evento": openEventEntry(id); break;
    case "niver": openBirthdayEntry(id); break;
    case "meta": openGoalEntry(id); break;
    case "habito": openHabitEntry(id); break;
  }
}

$("#atividade-search").addEventListener("input", () => renderAtividade());
$("#atividade-filter-type").addEventListener("change", () => renderAtividade());

function renderAtividade() {
  if (!currentUser) return;
  const search = $("#atividade-search").value;
  const typeFilter = $("#atividade-filter-type").value;
  const activity = buildActivityFeed({ typeFilter, search });
  $("#atividade-empty").classList.toggle("hidden", activity.length > 0);
  $("#atividade-list").innerHTML = activity.map(renderActivityRow).join("");
  attachActivityClickHandlers("#atividade-list");
}

/* =========================================================
   RESUMO DO DIA — mensagens contextuais estilo assistente pessoal
========================================================= */
function buildDailyBrief() {
  const items = [];
  const todayStr = new Date().toISOString().slice(0, 10);

  // Demandas pendentes
  const todoCount = kanbanItems.filter((i) => (i.status || "todo") === "todo").length;
  const doingCount = kanbanItems.filter((i) => i.status === "doing").length;
  const totalOpen = todoCount + doingCount;
  if (totalOpen > 0) {
    items.push({ icon: "📋", text: `Você tem <strong>${totalOpen} demanda(s)</strong> em aberto (${todoCount} para fazer, ${doingCount} em progresso).` });
  } else {
    items.push({ icon: "✅", text: "Nenhuma demanda pendente no momento." });
  }

  // Projetos parados: status "Pausado" ou sem atualização de progresso há 14+ dias
  const STALL_DAYS = 14;
  const now = Date.now();
  const stalledProjects = projectItems.filter((p) => {
    if (p.status === "Concluido") return false;
    if (p.status === "Pausado") return true;
    const log = p.progressLog || [];
    const lastDate = log.length ? new Date(log[log.length - 1].date) : tsToDate(p.createdAt);
    if (!lastDate) return false;
    return (now - lastDate.getTime()) / 86400000 >= STALL_DAYS;
  });
  if (stalledProjects.length) {
    const names = stalledProjects.slice(0, 3).map((p) => p.title).join(", ");
    items.push({ icon: "⏸️", text: `<strong>${stalledProjects.length} projeto(s)</strong> parado(s) há um tempo: ${escapeHtml(names)}${stalledProjects.length > 3 ? "…" : ""}.` });
  }

  // Próximo aniversário
  const nextBday = upcomingBirthdays(1)[0];
  if (nextBday) {
    items.push(nextBday.isToday
      ? { icon: "🎉", text: `Hoje é aniversário de <strong>${escapeHtml(nextBday.name)}</strong>!` }
      : { icon: "🎂", text: `Faltam <strong>${nextBday.daysLeft} dia(s)</strong> para o aniversário de ${escapeHtml(nextBday.name)}.` });
  }

  // Próximo prazo (projeto ou evento)
  const projectDeadlines = projectItems.filter((p) => p.deadline && p.status !== "Concluido").map((p) => ({ title: p.title, date: p.deadline, kind: "projeto" }));
  const eventDeadlines = upcomingEvents().map((e) => ({ title: e.title, date: e.date, kind: "evento" }));
  const nextDeadline = [...projectDeadlines, ...eventDeadlines].sort((a, b) => a.date.localeCompare(b.date))[0];
  if (nextDeadline) {
    const days = Math.round((new Date(nextDeadline.date + "T00:00:00") - new Date(todayStr + "T00:00:00")) / 86400000);
    const when = days === 0 ? "hoje" : days === 1 ? "amanhã" : `em ${days} dia(s)`;
    items.push({ icon: "⏰", text: `Próximo prazo: <strong>${escapeHtml(nextDeadline.title)}</strong> (${nextDeadline.kind}) ${when}.` });
  }

  // Última anotação do diário
  const lastDiary = [...diaryItems].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))[0];
  if (lastDiary) {
    const ts = tsToDate(lastDiary.updatedAt) || tsToDate(lastDiary.createdAt);
    items.push({ icon: "📓", text: `Sua última anotação no diário foi <strong>${relativeTime(ts)}</strong>: "${escapeHtml(lastDiary.title)}".` });
  }

  // Última observação AH/SD
  const lastAhsd = [...ahsdItems].sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime))[0];
  if (lastAhsd) {
    items.push({ icon: "🧠", text: `Última observação AH/SD registrada <strong>${relativeTime(new Date(lastAhsd.dateTime))}</strong>.` });
  }

  // Sugestão automática de prioridade
  let suggestion;
  if (stalledProjects.length) {
    suggestion = `Que tal retomar o projeto <strong>"${escapeHtml(stalledProjects[0].title)}"</strong>? Ele está parado há um tempo.`;
  } else if (totalOpen > 0) {
    suggestion = "Você tem demandas em aberto — mover uma para \"Em Progresso\" pode ajudar a manter o ritmo.";
  } else if (nextDeadline) {
    suggestion = `Fique de olho no prazo de "${escapeHtml(nextDeadline.title)}".`;
  } else {
    suggestion = "Tudo em dia por aqui! Bom momento para registrar uma ideia no diário ou planejar o próximo projeto.";
  }
  items.push({ icon: "💡", text: suggestion, suggestion: true });

  return items;
}

function renderDailyBrief() {
  if (!currentUser) return;
  const items = buildDailyBrief();
  $("#daily-brief-list").innerHTML = items.map((i) => `
    <div class="brief-item ${i.suggestion ? "brief-suggestion" : ""}">
      <span class="brief-icon">${i.icon}</span>
      <span class="brief-text">${i.text}</span>
    </div>
  `).join("");
}

/* =========================================================
   BUSCA GLOBAL (Ctrl+K) — estilo Notion/VSCode
========================================================= */
let cmdkResults = [];
let cmdkActiveIndex = -1;

function searchEverything(term) {
  const t = term.trim().toLowerCase();
  if (!t) return [];
  const results = [];

  diaryItems.forEach((i) => {
    const hay = [i.title, i.content, i.book, ...(i.tags || [])].join(" ").toLowerCase();
    if (hay.includes(t)) results.push({ type: "diario", id: i.id, text: i.title });
  });
  ahsdItems.forEach((i) => {
    const hay = [i.content, ...(i.tags || [])].join(" ").toLowerCase();
    if (hay.includes(t)) results.push({ type: "ahsd", id: i.id, text: i.content.slice(0, 60) });
  });
  kanbanItems.forEach((i) => {
    const hay = [i.title, i.description].join(" ").toLowerCase();
    if (hay.includes(t)) results.push({ type: "kanban", id: i.id, text: i.title });
  });
  projectItems.forEach((i) => {
    const hay = [i.title, i.description, i.category].join(" ").toLowerCase();
    if (hay.includes(t)) results.push({ type: "projeto", id: i.id, text: i.title });
  });
  eventItems.forEach((i) => {
    const hay = [i.title, i.notes].join(" ").toLowerCase();
    if (hay.includes(t)) results.push({ type: "evento", id: i.id, text: `${i.title} · ${fmtDate(new Date(i.date + "T00:00:00"))}` });
  });
  birthdayItems.forEach((i) => {
    if (i.name.toLowerCase().includes(t)) results.push({ type: "niver", id: i.id, text: `${i.name} · ${fmtDayMonth(i.day, i.month)}` });
  });
  goalItems.forEach((i) => {
    const hay = [i.title, i.description, i.category].join(" ").toLowerCase();
    if (hay.includes(t)) results.push({ type: "meta", id: i.id, text: i.title });
  });
  habitItems.forEach((i) => {
    const hay = [i.title, i.notes].join(" ").toLowerCase();
    if (hay.includes(t)) results.push({ type: "habito", id: i.id, text: `${i.emoji || "🔁"} ${i.title}` });
  });

  return results.slice(0, 40);
}

const CMDK_QUICK_ACTIONS = [
  { label: "+ Diário", view: "diario", btn: "#diario-new-btn" },
  { label: "+ AH/SD", view: "ahsd", btn: "#ahsd-new-btn" },
  { label: "+ Demanda", view: "kanban", btn: "#kanban-new-btn" },
  { label: "+ Projeto", view: "projetos", btn: "#projeto-new-btn" },
  { label: "+ Meta", view: "metas", btn: "#meta-new-btn" },
  { label: "+ Hábito", view: "habitos", btn: "#habito-new-btn" },
  { label: "+ Evento", view: "agenda", btn: "#evento-new-btn" },
  { label: "+ Aniversário", view: "agenda", btn: "#niver-new-btn" },
];

function renderCmdkQuickActions() {
  $("#cmdk-quick-actions").innerHTML = CMDK_QUICK_ACTIONS.map((a, idx) => `<button type="button" class="cmdk-quick-btn" data-idx="${idx}">${a.label}</button>`).join("");
  $$(".cmdk-quick-btn", $("#cmdk-quick-actions")).forEach((btn) => btn.addEventListener("click", () => {
    const action = CMDK_QUICK_ACTIONS[Number(btn.dataset.idx)];
    closeCmdk();
    switchView(action.view);
    setTimeout(() => $(action.btn)?.click(), 50);
  }));
}

function paintCmdkResults() {
  if (!cmdkResults.length) {
    $("#cmdk-results").innerHTML = `<p class="cmdk-empty">Nenhum resultado. Tente outro termo ou use os atalhos acima para criar algo novo.</p>`;
    return;
  }
  $("#cmdk-results").innerHTML = cmdkResults.map((r, idx) => {
    const meta = ACTIVITY_META[r.type];
    return `
      <div class="cmdk-result-row ${idx === cmdkActiveIndex ? "active" : ""}" data-idx="${idx}">
        <span class="cmdk-result-type" style="background:${meta.bg}; color:${meta.color};">${meta.label}</span>
        <span class="cmdk-result-text">${escapeHtml(r.text)}</span>
      </div>
    `;
  }).join("");
  $$(".cmdk-result-row", $("#cmdk-results")).forEach((row) => {
    row.addEventListener("click", () => selectCmdkResult(Number(row.dataset.idx)));
    row.addEventListener("mouseenter", () => { cmdkActiveIndex = Number(row.dataset.idx); paintCmdkResults(); });
  });
}

function renderCmdkResults(term) {
  cmdkResults = searchEverything(term);
  cmdkActiveIndex = cmdkResults.length ? 0 : -1;
  paintCmdkResults();
}

function selectCmdkResult(idx) {
  const r = cmdkResults[idx];
  if (!r) return;
  closeCmdk();
  openActivityItem(r.type, r.id);
}

function openCmdk() {
  if (!currentUser) return;
  $("#cmdk-overlay").classList.remove("hidden");
  renderCmdkQuickActions();
  $("#cmdk-input").value = "";
  $("#cmdk-results").innerHTML = "";
  cmdkResults = [];
  cmdkActiveIndex = -1;
  setTimeout(() => $("#cmdk-input").focus(), 30);
}
function closeCmdk() {
  $("#cmdk-overlay").classList.add("hidden");
}

$("#global-search-btn").addEventListener("click", openCmdk);
$("#cmdk-overlay").addEventListener("click", (e) => { if (e.target.id === "cmdk-overlay") closeCmdk(); });
$("#cmdk-input").addEventListener("input", (e) => renderCmdkResults(e.target.value));
$("#cmdk-input").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (cmdkResults.length) { cmdkActiveIndex = (cmdkActiveIndex + 1) % cmdkResults.length; paintCmdkResults(); }
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (cmdkResults.length) { cmdkActiveIndex = (cmdkActiveIndex - 1 + cmdkResults.length) % cmdkResults.length; paintCmdkResults(); }
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (cmdkActiveIndex >= 0) selectCmdkResult(cmdkActiveIndex);
  } else if (e.key === "Escape") {
    closeCmdk();
  }
});

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    if (!currentUser) return;
    $("#cmdk-overlay").classList.contains("hidden") ? openCmdk() : closeCmdk();
  } else if (e.key === "Escape" && !$("#cmdk-overlay").classList.contains("hidden")) {
    closeCmdk();
  }
});

/* =========================================================
   CALENDÁRIO INTERATIVO — Dashboard
   Mostra o mês atual (com navegação) e marca com pontinhos os dias
   que têm evento, aniversário ou prazo de projeto. Passar o mouse
   mostra um resumo (tooltip nativo); clicar lista os detalhes abaixo.
========================================================= */
let calendarViewDate = new Date();
let selectedCalendarDay = null; // "YYYY-MM-DD"

function pad2(n) { return String(n).padStart(2, "0"); }
function ymd(y, m, d) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }

function getDayInfo(dateObj) {
  const y = dateObj.getFullYear(), m = dateObj.getMonth(), d = dateObj.getDate();
  const dateStr = ymd(y, m, d);
  const events = eventItems.filter((i) => i.date === dateStr);
  const bdays = birthdayItems.filter((i) => i.day === d && i.month === m + 1);
  const deadlines = projectItems.filter((i) => i.deadline === dateStr && i.status !== "Concluido");
  return { events, bdays, deadlines };
}

function renderDayDetailsPanel(dateObj, info) {
  const panel = $("#cal-day-details");
  const total = info.events.length + info.bdays.length + info.deadlines.length;
  if (!total) { panel.innerHTML = ""; return; }
  const rows = [
    ...info.events.map((e) => ({ color: "var(--rust)", label: "Evento", text: e.title })),
    ...info.bdays.map((b) => ({ color: "var(--plum)", label: "Aniversário", text: `${b.name} 🎂` })),
    ...info.deadlines.map((p) => ({ color: "var(--teal)", label: "Prazo", text: p.title })),
  ];
  panel.innerHTML = `
    <p class="cal-day-details-title">${fmtDate(dateObj)}</p>
    ${rows.map((r) => `
      <div class="cal-day-detail-item">
        <span class="cal-dot" style="background:${r.color}"></span>
        <span>${escapeHtml(r.text)}</span>
        <span style="margin-left:auto; color:var(--ink-faint); font-size:0.7rem;">${r.label}</span>
      </div>
    `).join("")}
  `;
}

function renderCalendar() {
  const year = calendarViewDate.getFullYear();
  const month = calendarViewDate.getMonth();
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(calendarViewDate);
  $("#cal-month-label").textContent = label.charAt(0).toUpperCase() + label.slice(1);

  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const today = new Date();
  const todayStr = ymd(today.getFullYear(), today.getMonth(), today.getDate());

  let cellsHtml = "";
  for (let i = 0; i < 42; i++) {
    const cellDate = new Date(year, month, i - startWeekday + 1);
    const otherMonth = cellDate.getMonth() !== month;
    const cellStr = ymd(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate());
    const info = getDayInfo(cellDate);
    const hasEvents = info.events.length + info.bdays.length + info.deadlines.length > 0;
    const isToday = cellStr === todayStr;
    const isSelected = cellStr === selectedCalendarDay;

    const dots = [
      info.events.length ? `<span class="cal-dot" style="background:var(--rust)"></span>` : "",
      info.bdays.length ? `<span class="cal-dot" style="background:var(--plum)"></span>` : "",
      info.deadlines.length ? `<span class="cal-dot" style="background:var(--teal)"></span>` : "",
    ].join("");

    const titleParts = [
      ...info.events.map((e) => e.title),
      ...info.bdays.map((b) => `${b.name} (aniversário)`),
      ...info.deadlines.map((p) => `${p.title} (prazo)`),
    ];

    cellsHtml += `
      <div class="cal-day ${otherMonth ? "other-month" : ""} ${isToday ? "today" : ""} ${isSelected ? "selected" : ""} ${hasEvents ? "has-events" : ""}"
           data-date="${cellStr}" ${titleParts.length ? `title="${escapeHtml(titleParts.join(" · "))}"` : ""}>
        <span>${cellDate.getDate()}</span>
        <span class="cal-day-dots">${dots}</span>
      </div>
    `;
  }
  $("#cal-grid").innerHTML = cellsHtml;

  $$(".cal-day.has-events", $("#cal-grid")).forEach((cell) => {
    cell.addEventListener("click", () => {
      selectedCalendarDay = cell.dataset.date;
      renderCalendar();
    });
  });

  if (selectedCalendarDay) {
    const [sy, sm, sd] = selectedCalendarDay.split("-").map(Number);
    const sDate = new Date(sy, sm - 1, sd);
    renderDayDetailsPanel(sDate, getDayInfo(sDate));
  } else {
    $("#cal-day-details").innerHTML = "";
  }
}

$("#cal-prev-btn").addEventListener("click", () => {
  calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() - 1, 1);
  renderCalendar();
});
$("#cal-next-btn").addEventListener("click", () => {
  calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() + 1, 1);
  renderCalendar();
});