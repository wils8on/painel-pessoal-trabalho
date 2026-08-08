// =========================================================
// js/app.js — DOSSIÊ: Painel Pessoal e de Trabalho.
// Vanilla JS (ES6+) + Firebase v10 (modular SDK)
// =========================================================
import { auth, db, googleProvider } from "./firebase-config.js";
import { uploadFileToCloudinary } from "./cloudinary-config.js";
import { clampPercent, checklistProgress, safeHttpUrl, nextRecurringDate, validateBackup } from "./core-utils.js";
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

    if (/^>\s+/.test(line)) html += `<blockquote>${line.replace(/^>\s+/, "")}</blockquote>`;
    else if (/^###\s+/.test(line)) html += `<h3>${line.replace(/^###\s+/, "")}</h3>`;
    else if (/^##\s+/.test(line)) html += `<h2>${line.replace(/^##\s+/, "")}</h2>`;
    else if (/^#\s+/.test(line)) html += `<h1>${line.replace(/^#\s+/, "")}</h1>`;
    else if (line.trim() === "") html += "<br>";
    else html += `<p>${line}</p>`;
  }
  if (inList) html += "</ul>";
  return html
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, `<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>`);
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
let initialCollectionsPending = new Set();
function finishInitialLoad(collectionName) { initialCollectionsPending.delete(collectionName); if (!initialCollectionsPending.size) $("#app-loading").classList.add("hidden"); }

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
        finishInitialLoad(collectionName);
      }, (err) => { console.error(`Erro ao ler ${collectionName}:`, err); finishInitialLoad(collectionName); showToast(`Falha ao carregar ${collectionName}. Verifique a conexão e tente novamente.`, "error"); });
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
  initialCollectionsPending = new Set(["diaryEntries","ahsdNotes","kanbanTasks","projects","agendaEvents","birthdays","goals","habits"]); $("#app-loading").classList.remove("hidden");
  diaryApi.subscribe(uid, renderDiary);
  ahsdApi.subscribe(uid, renderAhsd);
  kanbanApi.subscribe(uid, renderKanban);
  projectsApi.subscribe(uid, renderProjects);
  eventsApi.subscribe(uid, renderEvents);
  birthdaysApi.subscribe(uid, renderBirthdays);
  goalsApi.subscribe(uid, renderGoals);
  habitsApi.subscribe(uid, renderHabits);
}

function recordClientError(error, source = "app") {
  const entry = { time: new Date().toISOString(), source, message: String(error?.message || error || "Erro desconhecido").slice(0, 500) };
  try { const history = JSON.parse(localStorage.getItem("nova-error-log") || "[]"); localStorage.setItem("nova-error-log", JSON.stringify([...history, entry].slice(-20))); } catch { /* armazenamento indisponível */ }
}
window.addEventListener("error", (event) => recordClientError(event.error || event.message, "window"));
window.addEventListener("unhandledrejection", (event) => { recordClientError(event.reason, "promise"); showToast("Ocorreu um erro inesperado. A ocorrência foi registrada localmente.", "error"); });

const BACKUP_COLLECTIONS = { diaryEntries: { api: diaryApi, get: () => diaryItems }, ahsdNotes: { api: ahsdApi, get: () => ahsdItems }, kanbanTasks: { api: kanbanApi, get: () => kanbanItems }, projects: { api: projectsApi, get: () => projectItems }, agendaEvents: { api: eventsApi, get: () => eventItems }, birthdays: { api: birthdaysApi, get: () => birthdayItems }, goals: { api: goalsApi, get: () => goalItems }, habits: { api: habitsApi, get: () => habitItems } };
$("#backup-export-btn").addEventListener("click", () => { if (!currentUser) return; const data = { version: 1, exportedAt: new Date().toISOString(), collections: Object.fromEntries(Object.entries(BACKUP_COLLECTIONS).map(([name, config]) => [name, config.get()])) }; const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `nova-backup-${new Date().toISOString().slice(0,10)}.json`; link.click(); URL.revokeObjectURL(url); showToast("Backup exportado."); });
$("#backup-import-btn").addEventListener("click", () => $("#backup-import-file").click());
$("#backup-import-file").addEventListener("change", async (event) => { const file = event.target.files?.[0]; if (!file || !currentUser) return; try { if (file.size > 25 * 1024 * 1024) throw new Error("Backup excede 25 MB"); const backup = JSON.parse(await file.text()); if (!validateBackup(backup, Object.keys(BACKUP_COLLECTIONS))) throw new Error("Estrutura de backup inválida"); if (!confirm("Restaurar este backup? Os registros serão adicionados e dados existentes não serão apagados.")) return; let count = 0; for (const [name, items] of Object.entries(backup.collections)) { const config = BACKUP_COLLECTIONS[name]; for (const raw of items) { const { id, userId, createdAt, updatedAt, ...data } = raw; await config.api.add(currentUser.uid, data); count++; } } showToast(`${count} registro(s) restaurado(s).`); } catch (err) { console.error(err); showToast(err.message || "Backup inválido ou não foi possível restaurar.", "error"); } finally { event.target.value = ""; } });

function updateConnectionState() { const offline = !navigator.onLine; $("#connection-banner").classList.toggle("hidden", !offline); document.body.classList.toggle("is-offline", offline); if (!offline) showToast("Conexão restabelecida."); }
window.addEventListener("offline", updateConnectionState); window.addEventListener("online", updateConnectionState); updateConnectionState();
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("Service Worker:", err)));

/* =========================================================
   MÓDULO 1 — Diário & Ideias Literárias
========================================================= */
let diaryItems = [];
const diaryForm = $("#diario-form-wrap");
const diaryAttachmentsFile = $("#diario-attachments-file");
const diaryAttachmentsStatus = $("#diario-attachments-status");
const diaryAttachmentsList = $("#diario-attachments-list");
let diaryAttachmentsDraft = []; // [{url, name, format, resourceType, bytes}]
let diaryLinkedProjects = [], diaryLinkedGoals = [], diaryLinkedHabits = [];
let diaryLiteraryLinks = [];

function renderDiaryLinks() {
  const groups = [["#diario-link-projects", projectItems || [], diaryLinkedProjects], ["#diario-link-goals", goalItems || [], diaryLinkedGoals], ["#diario-link-habits", habitItems || [], diaryLinkedHabits]];
  groups.forEach(([selector, items, selected]) => { $(selector).innerHTML = items.length ? items.map((item) => `<button type="button" class="tag-toggle ${selected.includes(item.id) ? "active" : ""}" data-id="${item.id}">${item.emoji ? `${escapeHtml(item.emoji)} ` : ""}${escapeHtml(item.title)}</button>`).join("") : `<span class="project-editor-empty">Nenhum item disponível.</span>`; });
  const editId = $("#diario-edit-id").value; const literary = diaryItems.filter((item) => item.id !== editId && item.category !== "Ideia Solta");
  $("#diario-literary-links").innerHTML = literary.length ? literary.map((item) => `<button type="button" class="tag-toggle ${diaryLiteraryLinks.includes(item.id) ? "active" : ""}" data-id="${item.id}">${escapeHtml(item.title)}</button>`).join("") : `<span class="project-editor-empty">Nenhuma outra ideia literária.</span>`;
}
[["#diario-link-projects", "project"], ["#diario-link-goals", "goal"], ["#diario-link-habits", "habit"]].forEach(([selector, type]) => $(selector).addEventListener("click", (event) => { const btn = event.target.closest(".tag-toggle"); if (!btn) return; const key = type === "project" ? diaryLinkedProjects : type === "goal" ? diaryLinkedGoals : diaryLinkedHabits; const next = key.includes(btn.dataset.id) ? key.filter((id) => id !== btn.dataset.id) : [...key, btn.dataset.id]; if (type === "project") diaryLinkedProjects = next; else if (type === "goal") diaryLinkedGoals = next; else diaryLinkedHabits = next; renderDiaryLinks(); }));
$("#diario-literary-links").addEventListener("click", (event) => { const btn = event.target.closest(".tag-toggle"); if (!btn) return; diaryLiteraryLinks = diaryLiteraryLinks.includes(btn.dataset.id) ? diaryLiteraryLinks.filter((id) => id !== btn.dataset.id) : [...diaryLiteraryLinks, btn.dataset.id]; renderDiaryLinks(); });

const DIARY_TEMPLATES = { daily: "# Reflexão do dia\n\n## O que aconteceu\n\n## Como me senti\n\n## Aprendizado\n\n## Próxima intenção\n", idea: "# Ideia\n\n## Essência\n\n## Por que importa\n\n## Possibilidades\n\n- Próximo passo\n", review: "# Revisão semanal\n\n## Conquistas\n\n- \n\n## Desafios\n\n## O que aprendi\n\n## Foco da próxima semana\n" };
$("#diario-template").addEventListener("change", (event) => { if (!event.target.value) return; if (!$("#diario-content").value || confirm("Substituir o conteúdo atual pelo template?")) { $("#diario-content").value = DIARY_TEMPLATES[event.target.value]; $("#diario-content").dispatchEvent(new Event("input")); } event.target.value = ""; });
$("#diario-content").addEventListener("input", () => { $("#diario-preview").innerHTML = mdToHtml($("#diario-content").value); });

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
  $("#diario-mood").value = ""; $("#diario-energy").value = 3; $("#diario-sleep").value = ""; $("#diario-location").value = ""; $("#diario-weather").value = ""; $("#diario-favorite").checked = false; $("#diario-pinned").checked = false;
  diaryLinkedProjects = []; diaryLinkedGoals = []; diaryLinkedHabits = []; renderDiaryLinks(); $("#diario-preview").innerHTML = "";
  diaryLiteraryLinks = []; $("#diario-universe").value = ""; $("#diario-maturity").value = ""; $("#diario-narrative-date").value = ""; $("#diario-role").value = ""; $("#diario-motivation").value = ""; $("#diario-conflict").value = ""; $("#diario-traits").value = ""; renderDiaryLinks();
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
    mood: $("#diario-mood").value || null, energy: Number($("#diario-energy").value), sleepHours: Number($("#diario-sleep").value) || null, location: $("#diario-location").value.trim(), weather: $("#diario-weather").value.trim(), favorite: $("#diario-favorite").checked, pinned: $("#diario-pinned").checked,
    linkedProjectIds: diaryLinkedProjects, linkedGoalIds: diaryLinkedGoals, linkedHabitIds: diaryLinkedHabits,
    universe: $("#diario-universe").value.trim(), maturity: $("#diario-maturity").value || null, narrativeDate: $("#diario-narrative-date").value.trim(), role: $("#diario-role").value.trim(), motivation: $("#diario-motivation").value.trim(), conflict: $("#diario-conflict").value.trim(), traits: $("#diario-traits").value.trim(), relatedLiteraryIds: diaryLiteraryLinks,
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
  $("#diario-mood").value = item.mood || ""; $("#diario-energy").value = item.energy ?? 3; $("#diario-sleep").value = item.sleepHours || ""; $("#diario-location").value = item.location || ""; $("#diario-weather").value = item.weather || ""; $("#diario-favorite").checked = Boolean(item.favorite); $("#diario-pinned").checked = Boolean(item.pinned);
  diaryLinkedProjects = [...(item.linkedProjectIds || [])]; diaryLinkedGoals = [...(item.linkedGoalIds || [])]; diaryLinkedHabits = [...(item.linkedHabitIds || [])]; renderDiaryLinks(); $("#diario-preview").innerHTML = mdToHtml(item.content);
  diaryLiteraryLinks = [...(item.relatedLiteraryIds || [])]; $("#diario-universe").value = item.universe || ""; $("#diario-maturity").value = item.maturity || ""; $("#diario-narrative-date").value = item.narrativeDate || ""; $("#diario-role").value = item.role || ""; $("#diario-motivation").value = item.motivation || ""; $("#diario-conflict").value = item.conflict || ""; $("#diario-traits").value = item.traits || ""; renderDiaryLinks();
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
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  $("#diario-empty").classList.toggle("hidden", filtered.length > 0);
  $("#diario-list").innerHTML = filtered.map((item) => {
    const atts = item.attachments || [];
    const images = atts.filter((a) => a.resourceType === "image");
    const files = atts.filter((a) => a.resourceType !== "image");
    const diaryRelations = [...(item.linkedProjectIds || []).map((id) => ({ type: "project", item: projectItems.find((entry) => entry.id === id) })), ...(item.linkedGoalIds || []).map((id) => ({ type: "goal", item: goalItems.find((entry) => entry.id === id) })), ...(item.linkedHabitIds || []).map((id) => ({ type: "habit", item: habitItems.find((entry) => entry.id === id) }))].filter((relation) => relation.item);
    return `
    <article class="entry-card">
      <div class="entry-card-top">
        <span class="entry-tag" style="background:var(--amber-soft); color:var(--amber);">${escapeHtml(item.category)}</span>
        <span class="badge badge-status">${escapeHtml(item.status || "Rascunho")}</span>
        ${item.pinned ? `<span title="Fixado">📌</span>` : ""}${item.favorite ? `<span title="Favorito">★</span>` : ""}
      </div>
      <h3 class="entry-title">${escapeHtml(item.title)}</h3>
      ${item.book ? `<p class="entry-meta"><span>📖 ${escapeHtml(item.book)}</span></p>` : ""}
      ${(item.mood || item.energy != null || item.sleepHours || item.location || item.weather) ? `<div class="diary-context-chips">${item.mood ? `<span>☺ ${escapeHtml(item.mood)}</span>` : ""}${item.energy != null ? `<span>⚡ ${item.energy}/5</span>` : ""}${item.sleepHours ? `<span>☾ ${item.sleepHours}h</span>` : ""}${item.location ? `<span>⌖ ${escapeHtml(item.location)}</span>` : ""}${item.weather ? `<span>☁ ${escapeHtml(item.weather)}</span>` : ""}</div>` : ""}
      <div class="entry-body">${mdToHtml(item.content)}</div>
      ${images.length ? `<div class="entry-gallery">${images.map((img) => `<a href="${img.url}" target="_blank" rel="noopener"><img src="${img.url}" alt="${escapeHtml(img.name)}" loading="lazy"></a>`).join("")}</div>` : ""}
      ${files.length ? `<div class="entry-files">${files.map((f) => `<a class="entry-file-chip" href="${f.url}" target="_blank" rel="noopener">${fileIconSvg()} ${escapeHtml(f.name)}</a>`).join("")}</div>` : ""}
      ${(item.tags || []).length ? `<div class="entry-tags">${item.tags.map((t) => `<span class="tag-chip">#${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      ${diaryRelations.length ? `<div class="linked-chips">${diaryRelations.map((relation) => `<button class="linked-chip" data-action="open-link" data-type="${relation.type}" data-id="${relation.item.id}">${escapeHtml(relation.item.emoji || "↗")} ${escapeHtml(relation.item.title)}</button>`).join("")}</div>` : ""}
      <div class="entry-actions">
        <button data-action="favorite" data-id="${item.id}">${item.favorite ? "Desfavoritar" : "Favoritar"}</button><button data-action="pin" data-id="${item.id}">${item.pinned ? "Desafixar" : "Fixar"}</button>
        <button data-action="edit" data-id="${item.id}">Editar</button>
        <button data-action="delete" data-id="${item.id}">Excluir</button>
      </div>
    </article>
  `;
  }).join("");

  $$('#diario-list [data-action="edit"]').forEach((btn) => btn.addEventListener("click", () => openDiaryEntry(btn.dataset.id)));
  $$('#diario-list [data-action="favorite"]').forEach((btn) => btn.addEventListener("click", () => { const item = diaryItems.find((entry) => entry.id === btn.dataset.id); diaryApi.update(item.id, { favorite: !item.favorite }); }));
  $$('#diario-list [data-action="pin"]').forEach((btn) => btn.addEventListener("click", () => { const item = diaryItems.find((entry) => entry.id === btn.dataset.id); diaryApi.update(item.id, { pinned: !item.pinned }); }));
  $$('#diario-list [data-action="open-link"]').forEach((btn) => btn.addEventListener("click", () => { if (btn.dataset.type === "project") openProjectEntry(btn.dataset.id); else if (btn.dataset.type === "goal") openGoalEntry(btn.dataset.id); else openHabitEntry(btn.dataset.id); }));
  $$('#diario-list [data-action="delete"]').forEach((btn) => btn.addEventListener("click", () => {
    if (confirm("Excluir esta anotação?")) { diaryApi.remove(btn.dataset.id); showToast("Anotação excluída."); }
  }));

  refreshDashboard();
  renderLiterary();
}

const LITERARY_TYPES = ["Capítulo", "Cena", "Personagem", "Plot", "Trama", "Nota de Pesquisa", "Local", "Objeto"];
function renderLiterary() {
  if (!$("#literatura-list")) return;
  const all = diaryItems.filter((item) => LITERARY_TYPES.includes(item.category));
  const books = [...new Set(all.map((item) => item.book).filter(Boolean))].sort(); const bookSelect = $("#literatura-book"); const currentBook = bookSelect.value; bookSelect.innerHTML = `<option value="">Todas as obras</option>${books.map((book) => `<option>${escapeHtml(book)}</option>`).join("")}`; bookSelect.value = currentBook;
  const search = $("#literatura-search").value.toLowerCase(), type = $("#literatura-type").value, book = bookSelect.value, maturity = $("#literatura-maturity").value;
  const filtered = all.filter((item) => !search || `${item.title} ${item.content} ${item.universe || ""}`.toLowerCase().includes(search)).filter((item) => !type || item.category === type).filter((item) => !book || item.book === book).filter((item) => !maturity || item.maturity === maturity);
  const counts = LITERARY_TYPES.map((typeName) => ({ type: typeName, count: all.filter((item) => item.category === typeName).length })).filter((entry) => entry.count);
  $("#literatura-coverage").innerHTML = `<div class="literary-stat"><strong>${all.length}</strong><span>elementos</span></div><div class="literary-stat"><strong>${books.length}</strong><span>obras</span></div><div class="literary-stat"><strong>${all.filter((item) => item.maturity === "Pronta").length}</strong><span>ideias prontas</span></div>${counts.map((entry) => `<div class="literary-type-count"><span>${entry.type}</span><strong>${entry.count}</strong></div>`).join("")}`;
  $("#literatura-empty").classList.toggle("hidden", filtered.length > 0);
  $("#literatura-list").innerHTML = filtered.map((item) => { const relations = (item.relatedLiteraryIds || []).map((id) => diaryItems.find((entry) => entry.id === id)).filter(Boolean); return `<article class="entry-card literary-card" data-id="${item.id}"><div class="entry-card-top"><span class="entry-tag">${escapeHtml(item.category)}</span><span class="badge badge-status">${escapeHtml(item.maturity || "Semente")}</span></div><h3 class="entry-title">${escapeHtml(item.title)}</h3><p class="entry-meta">${item.book ? `<span>📖 ${escapeHtml(item.book)}</span>` : ""}${item.universe ? `<span>✦ ${escapeHtml(item.universe)}</span>` : ""}${item.narrativeDate ? `<span>◷ ${escapeHtml(item.narrativeDate)}</span>` : ""}</p>${item.role ? `<p class="entry-body"><strong>Papel:</strong> ${escapeHtml(item.role)}</p>` : ""}${item.motivation ? `<p class="entry-body"><strong>Motivação:</strong> ${escapeHtml(item.motivation)}</p>` : ""}${item.conflict ? `<p class="entry-body"><strong>Conflito:</strong> ${escapeHtml(item.conflict)}</p>` : ""}<div class="entry-body">${mdToHtml(item.content)}</div>${relations.length ? `<div class="linked-chips">${relations.map((relation) => `<button class="linked-chip" data-related-id="${relation.id}">↗ ${escapeHtml(relation.title)}</button>`).join("")}</div>` : ""}<div class="entry-actions"><button data-edit-id="${item.id}">Editar</button></div></article>`; }).join("");
  $$("#literatura-list [data-edit-id]").forEach((btn) => btn.addEventListener("click", () => openDiaryEntry(btn.dataset.editId))); $$("#literatura-list [data-related-id]").forEach((btn) => btn.addEventListener("click", () => openDiaryEntry(btn.dataset.relatedId)));
}
$("#literatura-new-btn").addEventListener("click", () => { switchView("diario"); $("#diario-new-btn").click(); $("#diario-category").value = "Cena"; });
[$("#literatura-search"), $("#literatura-type"), $("#literatura-book"), $("#literatura-maturity")].forEach((element) => element.addEventListener(element.tagName === "INPUT" ? "input" : "change", renderLiterary));

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
  $("#kanban-priority").value = "Media"; $("#kanban-effort").value = "3"; $("#kanban-deadline").value = "";
  $("#kanban-labels").value = ""; $("#kanban-context").value = ""; $("#kanban-checklist").value = ""; $("#kanban-recurrence").value = "";
  kanbanForm.classList.remove("hidden");
});
$("#kanban-cancel-btn").addEventListener("click", () => kanbanForm.classList.add("hidden"));

$("#kanban-save-btn").addEventListener("click", async () => {
  const title = $("#kanban-title").value.trim();
  if (!title) return showToast("Informe um título para a demanda.", "error");
  const editId = $("#kanban-edit-id").value;
  const existing = editId ? kanbanItems.find((item) => item.id === editId) : null;
  const oldChecklist = existing?.checklist || [];
  const checklist = $("#kanban-checklist").value.split("\n").map((text) => text.trim()).filter(Boolean).map((text) => ({ id: oldChecklist.find((item) => item.text === text)?.id || projectDraftId(), text, done: oldChecklist.find((item) => item.text === text)?.done || false }));
  const payload = { title, description: $("#kanban-desc").value.trim(), priority: $("#kanban-priority").value, effort: Number($("#kanban-effort").value), deadline: $("#kanban-deadline").value || null, labels: $("#kanban-labels").value.split(",").map((label) => label.trim()).filter(Boolean), context: $("#kanban-context").value.trim(), checklist, recurrence: $("#kanban-recurrence").value || null };
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
  $("#kanban-priority").value = item.priority || "Media"; $("#kanban-effort").value = item.effort || 3; $("#kanban-deadline").value = item.deadline || "";
  $("#kanban-labels").value = (item.labels || []).join(", "); $("#kanban-context").value = item.context || ""; $("#kanban-checklist").value = (item.checklist || []).map((entry) => entry.text).join("\n"); $("#kanban-recurrence").value = item.recurrence || "";
  kanbanForm.classList.remove("hidden");
}

function renderKanban(items) {
  if (items) kanbanItems = items;
  const search = $("#kanban-search").value.toLowerCase();
  const priorityFilter = $("#kanban-filter-priority").value;
  const labelFilter = $("#kanban-filter-label").value;
  const labels = [...new Set(kanbanItems.flatMap((item) => item.labels || []))].sort();
  const labelSelect = $("#kanban-filter-label"); const selectedLabel = labelSelect.value;
  labelSelect.innerHTML = `<option value="">Todas as etiquetas</option>${labels.map((label) => `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`).join("")}`; labelSelect.value = selectedLabel;
  const cols = { todo: [], doing: [], done: [] };
  [...kanbanItems]
    .filter((item) => !search || `${item.title} ${item.description || ""} ${(item.labels || []).join(" ")} ${item.context || ""}`.toLowerCase().includes(search))
    .filter((item) => !priorityFilter || (item.priority || "Media") === priorityFilter)
    .filter((item) => !labelFilter || (item.labels || []).includes(labelFilter))
    .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
    .forEach((item) => cols[item.status || "todo"].push(item));

  ["todo", "doing", "done"].forEach((status) => {
    $(`#count-${status}`).textContent = cols[status].length;
    $(`#col-${status}`).innerHTML = cols[status].map((item) => `
      <div class="kanban-card priority-${(item.priority || "Media").toLowerCase()}" draggable="true" data-id="${item.id}">
        <div class="kanban-card-badges"><span class="badge ${PRIORITY_BADGE[item.priority || "Media"]}">${PRIORITY_LABEL[item.priority || "Media"]}</span><span class="kanban-effort">${item.effort || 3} pt</span>${item.recurrence ? `<span class="kanban-recurring">↻ ${item.recurrence}</span>` : ""}</div>
        <p class="kanban-card-title">${escapeHtml(item.title)}</p>
        ${item.description ? `<p class="kanban-card-desc">${escapeHtml(item.description)}</p>` : ""}
        ${(item.labels || []).length ? `<div class="kanban-labels">${item.labels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>` : ""}
        <div class="kanban-meta">${item.context ? `<span>◎ ${escapeHtml(item.context)}</span>` : ""}${item.deadline ? `<span class="${item.deadline < new Date().toISOString().slice(0,10) && item.status !== "done" ? "overdue" : ""}">◷ ${fmtDate(new Date(item.deadline + "T00:00:00"))}</span>` : ""}</div>
        ${(item.checklist || []).length ? `<div class="kanban-checklist">${item.checklist.map((check) => `<label class="${check.done ? "done" : ""}"><input type="checkbox" data-action="check" data-id="${item.id}" data-check-id="${check.id}" ${check.done ? "checked" : ""}/><span>${escapeHtml(check.text)}</span></label>`).join("")}</div>` : ""}
        <div class="kanban-comments">${(item.comments || []).slice(-2).map((comment) => `<p><strong>${escapeHtml(comment.author || "Você")}</strong> ${escapeHtml(comment.text)}</p>`).join("")}<div><input class="input" id="kanban-comment-${item.id}" placeholder="Adicionar comentário…"/><button data-action="comment" data-id="${item.id}">Enviar</button></div></div>
        <div class="kanban-card-actions">
          <button data-action="edit" data-id="${item.id}">Editar</button>
          <button data-action="delete" data-id="${item.id}">Excluir</button>
        </div>
      </div>
    `).join("");
  });
  $$('.kanban-card [data-action="check"]').forEach((input) => input.addEventListener("change", async (e) => { e.stopPropagation(); const task = kanbanItems.find((item) => item.id === input.dataset.id); const checklist = (task.checklist || []).map((check) => check.id === input.dataset.checkId ? { ...check, done: !check.done } : check); await kanbanApi.update(task.id, { checklist }); }));
  $$('.kanban-card [data-action="comment"]').forEach((btn) => btn.addEventListener("click", async (e) => { e.stopPropagation(); const input = $(`#kanban-comment-${btn.dataset.id}`); const text = input.value.trim(); if (!text) return; const task = kanbanItems.find((item) => item.id === btn.dataset.id); await kanbanApi.update(task.id, { comments: [...(task.comments || []), { id: projectDraftId(), text, author: currentUser.displayName || "Você", date: new Date().toISOString() }] }); }));

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
  zone.addEventListener("drop", async (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    const id = e.dataTransfer.getData("text/plain");
    const status = zone.closest(".kanban-col").dataset.status;
    const existing = kanbanItems.find((item) => item.id === id);
    await kanbanApi.update(id, { status, completedAt: status === "done" ? (existing?.completedAt || new Date().toISOString()) : null });
    if (status === "done" && existing?.recurrence && !existing.recurrenceGeneratedAt) {
      const nextDeadline = nextRecurringDate(existing.deadline, existing.recurrence);
      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, completedAt: _completedAt, status: _status, comments: _comments, recurrenceGeneratedAt: _generated, userId: _userId, ...copy } = existing;
      await kanbanApi.add(currentUser.uid, { ...copy, title: existing.title, status: "todo", deadline: nextDeadline, checklist: (existing.checklist || []).map((item) => ({ ...item, done: false })), comments: [] });
      await kanbanApi.update(id, { recurrenceGeneratedAt: new Date().toISOString() });
      showToast("Próxima demanda recorrente criada.");
    }
  });
});

/* =========================================================
   MÓDULO 4 — Projetos & Planos (formulário detalhado)
========================================================= */
let projectItems = [];
const projetoForm = $("#projeto-form-wrap");
let projetoChecklistDraft = [];
let projetoLinksDraft = [];
let projetoDependencyDraft = [];

const PRIORITY_BADGE = { Baixa: "badge-baixa", Media: "badge-media", Alta: "badge-alta", Critica: "badge-critica" };
const PRIORITY_LABEL = { Baixa: "Baixa", Media: "Média", Alta: "Alta", Critica: "Crítica" };

function projectDraftId() {
  return globalThis.crypto?.randomUUID?.() || `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function renderProjectChecklistEditor() {
  $("#projeto-checklist-editor").innerHTML = projetoChecklistDraft.length ? projetoChecklistDraft.map((item) => `
    <div class="project-editor-row" data-id="${item.id}">
      <input type="checkbox" data-field="done" ${item.done ? "checked" : ""} aria-label="Item concluído" />
      <input type="text" class="input" data-field="text" value="${escapeHtml(item.text)}" placeholder="Descreva a entrega" />
      <button type="button" class="project-editor-remove" data-action="remove" aria-label="Remover item">×</button>
    </div>`).join("") : `<p class="project-editor-empty">Nenhum item. Adicione entregas para calcular o progresso automaticamente.</p>`;
  const completed = projetoChecklistDraft.filter((item) => item.done).length;
  $("#projeto-progress").disabled = projetoChecklistDraft.length > 0;
  if (projetoChecklistDraft.length) {
    const progress = Math.round(completed / projetoChecklistDraft.length * 100);
    $("#projeto-progress").value = progress;
    $("#projeto-progress-value").textContent = progress;
  }
}

function renderProjectLinksEditor() {
  $("#projeto-links-editor").innerHTML = projetoLinksDraft.length ? projetoLinksDraft.map((link) => `
    <div class="project-editor-row project-link-editor-row" data-id="${link.id}">
      <input type="text" class="input" data-field="label" value="${escapeHtml(link.label)}" placeholder="Nome do link" />
      <input type="url" class="input" data-field="url" value="${escapeHtml(link.url)}" placeholder="https://…" />
      <button type="button" class="project-editor-remove" data-action="remove" aria-label="Remover link">×</button>
    </div>`).join("") : `<p class="project-editor-empty">Nenhum link adicionado.</p>`;
}

function renderProjectDependencies() {
  const editingId = $("#projeto-edit-id").value;
  const available = projectItems.filter((project) => project.id !== editingId);
  $("#projeto-dependencies").innerHTML = available.length ? available.map((project) => `
    <button type="button" class="tag-toggle ${projetoDependencyDraft.includes(project.id) ? "active" : ""}" data-id="${project.id}">${escapeHtml(project.title)}</button>`).join("") : `<span class="project-editor-empty">Nenhum outro projeto disponível.</span>`;
}

$("#projeto-checklist-add").addEventListener("click", () => { projetoChecklistDraft.push({ id: projectDraftId(), text: "", done: false }); renderProjectChecklistEditor(); });
$("#projeto-link-add").addEventListener("click", () => { projetoLinksDraft.push({ id: projectDraftId(), label: "", url: "" }); renderProjectLinksEditor(); });
$("#projeto-checklist-editor").addEventListener("input", (event) => {
  const row = event.target.closest(".project-editor-row"); if (!row) return;
  const item = projetoChecklistDraft.find((entry) => entry.id === row.dataset.id); if (!item) return;
  item[event.target.dataset.field] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
  if (event.target.type === "checkbox") renderProjectChecklistEditor();
});

$("#kanban-search").addEventListener("input", () => renderKanban());
$("#kanban-filter-priority").addEventListener("change", () => renderKanban());
$("#kanban-filter-label").addEventListener("change", () => renderKanban());
$("#projeto-checklist-editor").addEventListener("click", (event) => { if (event.target.dataset.action !== "remove") return; projetoChecklistDraft = projetoChecklistDraft.filter((item) => item.id !== event.target.closest(".project-editor-row").dataset.id); renderProjectChecklistEditor(); });
$("#projeto-links-editor").addEventListener("input", (event) => { const row = event.target.closest(".project-editor-row"); const link = projetoLinksDraft.find((entry) => entry.id === row?.dataset.id); if (link) link[event.target.dataset.field] = event.target.value; });
$("#projeto-links-editor").addEventListener("click", (event) => { if (event.target.dataset.action !== "remove") return; projetoLinksDraft = projetoLinksDraft.filter((link) => link.id !== event.target.closest(".project-editor-row").dataset.id); renderProjectLinksEditor(); });
$("#projeto-dependencies").addEventListener("click", (event) => { const button = event.target.closest(".tag-toggle"); if (!button) return; projetoDependencyDraft = projetoDependencyDraft.includes(button.dataset.id) ? projetoDependencyDraft.filter((id) => id !== button.dataset.id) : [...projetoDependencyDraft, button.dataset.id]; renderProjectDependencies(); });

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
  $("#projeto-next-action").value = "";
  $("#projeto-hours-estimated").value = "";
  $("#projeto-hours-spent").value = "";
  $("#projeto-risks").value = "";
  projetoChecklistDraft = [];
  projetoLinksDraft = [];
  projetoDependencyDraft = [];
  renderProjectChecklistEditor(); renderProjectLinksEditor(); renderProjectDependencies();
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
  let newProgress = Number($("#projeto-progress").value);
  const editId = $("#projeto-edit-id").value;
  const existing = editId ? projectItems.find((i) => i.id === editId) : null;
  const existingLog = existing?.progressLog || [];
  const checklist = projetoChecklistDraft.map((item) => ({ id: item.id, text: item.text.trim(), done: Boolean(item.done) })).filter((item) => item.text);
  const usefulLinks = projetoLinksDraft.map((link) => ({ id: link.id, label: link.label.trim(), url: link.url.trim() })).filter((link) => link.label && link.url);
  if (checklist.length) newProgress = checklistProgress(checklist, newProgress);
  let projectStatus = $("#projeto-status").value;
  if (projectStatus === "Concluido") newProgress = 100;
  if (newProgress >= 100) projectStatus = "Concluido";

  const payload = {
    title,
    category: $("#projeto-category").value,
    priority: $("#projeto-priority").value,
    status: projectStatus,
    start: $("#projeto-start").value || null,
    deadline: $("#projeto-deadline").value || null,
    description: $("#projeto-desc").value.trim(),
    nextSteps: $("#projeto-next").value.trim(),
    nextAction: $("#projeto-next-action").value.trim(),
    hoursEstimated: Math.max(0, Number($("#projeto-hours-estimated").value) || 0),
    hoursSpent: Math.max(0, Number($("#projeto-hours-spent").value) || 0),
    risks: $("#projeto-risks").value.split("\n").map((risk) => risk.trim()).filter(Boolean),
    checklist,
    usefulLinks,
    dependencyProjectIds: projetoDependencyDraft,
    progress: newProgress,
    completedAt: projectStatus === "Concluido" ? (existing?.completedAt || new Date().toISOString()) : null,
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
  const clamped = clampPercent(percent);
  const log = [...(item.progressLog || []), { date: new Date().toISOString(), percent: clamped, note: note?.trim() || "" }];
  try {
    await projectsApi.update(id, { progress: clamped, status: clamped >= 100 ? "Concluido" : (item.status === "Concluido" ? "Em andamento" : item.status), progressLog: log, completedAt: clamped >= 100 ? (item.completedAt || new Date().toISOString()) : null });
    showToast("Progresso atualizado.");
  } catch (err) {
    console.error(err);
    showToast("Não foi possível registrar a atualização. Tente novamente.", "error");
  }
}

async function toggleProjectChecklistItem(projectId, checklistId) {
  const project = projectItems.find((item) => item.id === projectId);
  if (!project) return;
  const checklist = (project.checklist || []).map((item) => item.id === checklistId ? { ...item, done: !item.done } : item);
  const progress = checklistProgress(checklist, project.progress || 0);
  const progressLog = progress !== project.progress ? [...(project.progressLog || []), { date: new Date().toISOString(), percent: progress, note: "Checklist atualizado" }] : (project.progressLog || []);
  try {
    await projectsApi.update(projectId, { checklist, progress, status: progress >= 100 ? "Concluido" : (project.status === "Concluido" ? "Em andamento" : project.status), progressLog, completedAt: progress >= 100 ? (project.completedAt || new Date().toISOString()) : null });
  } catch (err) {
    console.error(err);
    showToast("Não foi possível atualizar o checklist.", "error");
  }
}

function safeProjectUrl(raw = "") {
  return safeHttpUrl(raw);
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
  $("#projeto-next-action").value = item.nextAction || "";
  $("#projeto-hours-estimated").value = item.hoursEstimated || "";
  $("#projeto-hours-spent").value = item.hoursSpent || "";
  $("#projeto-risks").value = (item.risks || []).join("\n");
  projetoChecklistDraft = (item.checklist || []).map((entry) => ({ id: entry.id || projectDraftId(), text: entry.text || "", done: Boolean(entry.done) }));
  projetoLinksDraft = (item.usefulLinks || []).map((entry) => ({ id: entry.id || projectDraftId(), label: entry.label || "", url: entry.url || "" }));
  projetoDependencyDraft = [...(item.dependencyProjectIds || [])];
  renderProjectChecklistEditor(); renderProjectLinksEditor(); renderProjectDependencies();
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
    const checklist = item.checklist || [];
    const checklistDone = checklist.filter((entry) => entry.done).length;
    const dependencies = (item.dependencyProjectIds || []).map((id) => projectItems.find((project) => project.id === id)).filter(Boolean);
    const validLinks = (item.usefulLinks || []).map((link) => ({ ...link, safeUrl: safeProjectUrl(link.url) })).filter((link) => link.safeUrl);
    const hourPct = item.hoursEstimated ? Math.min(100, Math.round((item.hoursSpent || 0) / item.hoursEstimated * 100)) : 0;
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
      ${item.nextAction ? `<div class="project-next-action"><span>Próxima ação</span><strong>${escapeHtml(item.nextAction)}</strong></div>` : ""}
      ${checklist.length ? `<div class="project-card-checklist"><div class="project-card-section-title"><span>Checklist</span><small>${checklistDone}/${checklist.length}</small></div>${checklist.map((entry) => `<label class="project-check-item ${entry.done ? "done" : ""}"><input type="checkbox" data-action="toggle-check" data-project-id="${item.id}" data-check-id="${entry.id}" ${entry.done ? "checked" : ""}/><span>${escapeHtml(entry.text)}</span></label>`).join("")}</div>` : ""}
      ${(item.hoursEstimated || item.hoursSpent) ? `<div class="project-hours"><div class="project-card-section-title"><span>Horas</span><small>${item.hoursSpent || 0}h / ${item.hoursEstimated || 0}h</small></div>${item.hoursEstimated ? `<div class="project-hours-track"><span class="${(item.hoursSpent || 0) > item.hoursEstimated ? "over" : ""}" style="width:${hourPct}%"></span></div>` : ""}</div>` : ""}
      ${(item.risks || []).length ? `<div class="project-risks"><strong>Riscos e impedimentos</strong>${item.risks.map((risk) => `<span>⚠ ${escapeHtml(risk)}</span>`).join("")}</div>` : ""}
      ${dependencies.length ? `<div class="project-card-links"><span class="project-card-section-label">Depende de:</span>${dependencies.map((project) => `<button type="button" class="linked-chip" data-action="open-dependency" data-id="${project.id}">📁 ${escapeHtml(project.title)}</button>`).join("")}</div>` : ""}
      ${validLinks.length ? `<div class="project-card-links"><span class="project-card-section-label">Links:</span>${validLinks.map((link) => `<a class="project-link-chip" href="${escapeHtml(link.safeUrl)}" target="_blank" rel="noopener noreferrer">↗ ${escapeHtml(link.label)}</a>`).join("")}</div>` : ""}
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
  $$('#projeto-list [data-action="toggle-check"]').forEach((input) => input.addEventListener("change", () => toggleProjectChecklistItem(input.dataset.projectId, input.dataset.checkId)));
  $$('#projeto-list [data-action="open-dependency"]').forEach((btn) => btn.addEventListener("click", () => openProjectEntry(btn.dataset.id)));
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
  let newProgress = clampPercent($("#meta-progress").value);
  const editId = $("#meta-edit-id").value;
  const existing = editId ? goalItems.find((i) => i.id === editId) : null;
  const existingLog = existing?.progressLog || [];
  let goalStatus = $("#meta-status").value;
  if (goalStatus === "Concluida") newProgress = 100;
  if (newProgress >= 100) goalStatus = "Concluida";
  const payload = {
    title,
    category: $("#meta-category").value,
    priority: $("#meta-priority").value,
    status: goalStatus,
    deadline: $("#meta-deadline").value || null,
    description: $("#meta-desc").value.trim(),
    progress: newProgress,
    linkedProjectIds: metaLinkProjects,
    linkedTaskIds: metaLinkTasks,
    linkedHabitIds: metaLinkHabits,
    completedAt: goalStatus === "Concluida" ? (existing?.completedAt || new Date().toISOString()) : null,
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
  const clamped = clampPercent(percent);
  const log = [...(item.progressLog || []), { date: new Date().toISOString(), percent: clamped, note: note?.trim() || "" }];
  try {
    await goalsApi.update(id, { progress: clamped, status: clamped >= 100 ? "Concluida" : (item.status === "Concluida" ? "Em andamento" : item.status), progressLog: log, completedAt: clamped >= 100 ? (item.completedAt || new Date().toISOString()) : null });
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
let pessoaProjectLinks = [], pessoaTaskLinks = [];

const pessoaPhotoInput = $("#pessoa-photo");
pessoaPhotoInput.type = "hidden";
pessoaPhotoInput.parentElement.classList.remove("form-row-3");
pessoaPhotoInput.parentElement.classList.add("form-row-2");
pessoaPhotoInput.parentElement.insertAdjacentHTML("afterend", `
  <div class="person-photo-upload image-upload">
    <label class="image-upload-label" for="pessoa-photo-file">📷 Escolher foto do computador</label>
    <input type="file" id="pessoa-photo-file" accept="image/*" class="image-upload-input" />
    <span class="image-upload-status" id="pessoa-photo-status"></span>
    <div id="pessoa-photo-preview-wrap" class="person-photo-preview-wrap hidden">
      <img id="pessoa-photo-preview" class="person-photo-preview" alt="Prévia da foto" />
      <button type="button" class="btn btn-ghost btn-sm" id="pessoa-photo-remove">Remover foto</button>
    </div>
  </div>
`);

function renderPessoaPhotoPreview(url = "") {
  pessoaPhotoInput.value = url;
  $("#pessoa-photo-preview").src = url;
  $("#pessoa-photo-preview-wrap").classList.toggle("hidden", !url);
}

$("#pessoa-photo-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("Escolha um arquivo de imagem.", "error");
    event.target.value = "";
    return;
  }
  const status = $("#pessoa-photo-status");
  status.textContent = "Enviando foto…";
  try {
    const result = await uploadFileToCloudinary(file);
    renderPessoaPhotoPreview(result.url);
    status.textContent = "Foto enviada ✓";
  } catch (err) {
    console.error(err);
    status.textContent = "";
    showToast(err.message || "Não foi possível enviar a foto.", "error");
  } finally {
    event.target.value = "";
    setTimeout(() => { status.textContent = ""; }, 2500);
  }
});

$("#pessoa-photo-remove").addEventListener("click", () => renderPessoaPhotoPreview());

function populateDaySelect() {
  const select = $("#niver-day");
  if (select.options.length) return;
  for (let d = 1; d <= 31; d++) {
    const opt = document.createElement("option");
    opt.value = String(d);
    opt.textContent = String(d).padStart(2, "0");
    select.appendChild(opt);
  }
  const pessoaDay = $("#pessoa-day"); if (!pessoaDay.options.length) for (let d = 1; d <= 31; d++) pessoaDay.add(new Option(String(d).padStart(2, "0"), String(d)));
}

function renderPessoaLinks() { const groups = [["#pessoa-projects", projectItems, pessoaProjectLinks], ["#pessoa-tasks", kanbanItems, pessoaTaskLinks]]; groups.forEach(([selector, items, selected]) => { $(selector).innerHTML = items.length ? items.map((item) => `<button type="button" class="tag-toggle ${selected.includes(item.id) ? "active" : ""}" data-id="${item.id}">${escapeHtml(item.title)}</button>`).join("") : `<span class="project-editor-empty">Nenhum item disponível.</span>`; }); }
[["#pessoa-projects", "project"], ["#pessoa-tasks", "task"]].forEach(([selector, type]) => $(selector).addEventListener("click", (event) => { const btn = event.target.closest(".tag-toggle"); if (!btn) return; const current = type === "project" ? pessoaProjectLinks : pessoaTaskLinks; const next = current.includes(btn.dataset.id) ? current.filter((id) => id !== btn.dataset.id) : [...current, btn.dataset.id]; if (type === "project") pessoaProjectLinks = next; else pessoaTaskLinks = next; renderPessoaLinks(); }));
function resetPessoaForm() { $("#pessoa-id").value = ""; ["name","email","phone","company","role","last-contact","social","notes"].forEach((field) => $(`#pessoa-${field}`).value = ""); renderPessoaPhotoPreview(); $("#pessoa-category").value = "Amigos"; $("#pessoa-day").value = "1"; $("#pessoa-month").value = "1"; $("#pessoa-frequency").value = 30; pessoaProjectLinks = []; pessoaTaskLinks = []; renderPessoaLinks(); }
$("#pessoa-new-btn").addEventListener("click", () => { resetPessoaForm(); $("#pessoa-form").classList.remove("hidden"); }); $("#pessoa-cancel").addEventListener("click", () => $("#pessoa-form").classList.add("hidden"));
$("#pessoa-save").addEventListener("click", async () => { const name = $("#pessoa-name").value.trim(); if (!name) return showToast("Informe o nome.", "error"); const id = $("#pessoa-id").value; const existing = id ? birthdayItems.find((item) => item.id === id) : null; const payload = { name, day: Number($("#pessoa-day").value), month: Number($("#pessoa-month").value), category: $("#pessoa-category").value, email: $("#pessoa-email").value.trim(), phone: $("#pessoa-phone").value.trim(), photoUrl: safeProjectUrl($("#pessoa-photo").value), company: $("#pessoa-company").value.trim(), role: $("#pessoa-role").value.trim(), contactFrequencyDays: Number($("#pessoa-frequency").value) || 30, lastContact: $("#pessoa-last-contact").value || null, socialUrl: safeProjectUrl($("#pessoa-social").value), notes: $("#pessoa-notes").value.trim(), linkedProjectIds: pessoaProjectLinks, linkedTaskIds: pessoaTaskLinks, interactions: existing?.interactions || [] }; if (id) await birthdaysApi.update(id, payload); else await birthdaysApi.add(currentUser.uid, payload); $("#pessoa-form").classList.add("hidden"); showToast("Pessoa salva."); });
function openPerson(id) { const item = birthdayItems.find((entry) => entry.id === id); if (!item) return; switchView("pessoas"); $("#pessoa-id").value = item.id; $("#pessoa-name").value = item.name; $("#pessoa-category").value = item.category || "Contatos"; $("#pessoa-email").value = item.email || ""; $("#pessoa-phone").value = item.phone || ""; renderPessoaPhotoPreview(item.photoUrl || ""); $("#pessoa-company").value = item.company || ""; $("#pessoa-role").value = item.role || ""; $("#pessoa-day").value = item.day; $("#pessoa-month").value = item.month; $("#pessoa-frequency").value = item.contactFrequencyDays || 30; $("#pessoa-last-contact").value = item.lastContact || ""; $("#pessoa-social").value = item.socialUrl || ""; $("#pessoa-notes").value = item.notes || ""; pessoaProjectLinks = [...(item.linkedProjectIds || [])]; pessoaTaskLinks = [...(item.linkedTaskIds || [])]; renderPessoaLinks(); $("#pessoa-form").classList.remove("hidden"); }
function renderPeople() { if (!$("#pessoa-list")) return; const search = $("#pessoa-search").value.toLowerCase(), category = $("#pessoa-filter-category").value, today = new Date(); const people = birthdayItems.filter((item) => !category || (item.category || "Contatos") === category).filter((item) => !search || `${item.name} ${item.email || ""} ${item.company || ""} ${item.role || ""}`.toLowerCase().includes(search)); $("#pessoa-empty").classList.toggle("hidden", people.length > 0); $("#pessoa-list").innerHTML = people.map((item) => { const last = item.lastContact ? new Date(item.lastContact + "T00:00:00") : null; const days = last ? Math.floor((today-last)/86400000) : null; const due = days === null || days >= (item.contactFrequencyDays || 30); return `<article class="person-card glass-card"><div class="person-head">${item.photoUrl ? `<img src="${escapeHtml(item.photoUrl)}" alt=""/>` : `<span class="person-avatar">${escapeHtml(item.name.charAt(0))}</span>`}<div><h3>${escapeHtml(item.name)}</h3><span>${escapeHtml(item.category || "Contatos")}</span></div>${due ? `<b class="contact-due">Contato pendente</b>` : ""}</div><p class="entry-meta"><span>🎂 ${fmtDayMonth(item.day,item.month)}</span>${item.company ? `<span>${escapeHtml(item.company)}${item.role ? ` · ${escapeHtml(item.role)}` : ""}</span>` : ""}</p>${item.email ? `<a href="mailto:${escapeHtml(item.email)}">${escapeHtml(item.email)}</a>` : ""}${item.phone ? `<a href="tel:${escapeHtml(item.phone)}">${escapeHtml(item.phone)}</a>` : ""}${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}<div class="person-actions"><button data-person-contact="${item.id}">Registrar contato</button><button data-person-edit="${item.id}">Editar</button></div></article>`; }).join(""); $$("[data-person-edit]").forEach((btn) => btn.addEventListener("click", () => openPerson(btn.dataset.personEdit))); $$("[data-person-contact]").forEach((btn) => btn.addEventListener("click", async () => { const item = birthdayItems.find((entry) => entry.id === btn.dataset.personContact); const now = new Date().toISOString(); await birthdaysApi.update(item.id, { lastContact: now.slice(0,10), interactions: [...(item.interactions || []), { date: now, note: "Contato registrado" }] }); showToast("Interação registrada."); })); }
$("#pessoa-search").addEventListener("input", renderPeople); $("#pessoa-filter-category").addEventListener("change", renderPeople);

function startNewEvent(date = "") {
  $("#evento-edit-id").value = "";
  $("#evento-title").value = "";
  $("#evento-date").value = date;
  $("#evento-time").value = "";
  $("#evento-notes").value = "";
  eventoForm.classList.remove("hidden");
  $("#evento-title").focus();
}

$("#evento-new-btn").addEventListener("click", () => startNewEvent());
$("#evento-cancel-btn").addEventListener("click", () => eventoForm.classList.add("hidden"));

$("#evento-save-btn").addEventListener("click", async () => {
  const title = $("#evento-title").value.trim();
  const date = $("#evento-date").value;
  if (!title || !date) return showToast("Preencha título e data do evento.", "error");
  const payload = { title, date, time: $("#evento-time").value || null, notes: $("#evento-notes").value.trim() };
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

function eventDateTime(item) {
  return new Date(`${item.date}T${item.time || "23:59"}:00`);
}

function upcomingEvents() {
  const now = new Date();
  return eventItems
    .filter((item) => item.date && eventDateTime(item) >= now)
    .sort((a, b) => eventDateTime(a) - eventDateTime(b));
}

function openEventEntry(id) {
  const item = eventItems.find((i) => i.id === id);
  if (!item) return;
  switchView("agenda");
  $("#evento-edit-id").value = item.id;
  $("#evento-title").value = item.title;
  $("#evento-date").value = item.date;
  $("#evento-time").value = item.time || "";
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
        <span class="list-item-date">${fmtDate(new Date(item.date + "T00:00:00"))}${item.time ? ` · ${item.time}` : " · sem horário"}</span>
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
  renderPeople();
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
  const contactDueCount = birthdayItems.filter((person) => { if (!person.lastContact) return Boolean(person.email || person.phone || person.category); return Math.floor((Date.now() - new Date(person.lastContact + "T00:00:00")) / 86400000) >= (person.contactFrequencyDays || 30); }).length;
  const stats = [
    { value: diaryItems.length, label: "Anotações no diário" },
    { value: ahsdItems.length, label: "Registros AH/SD" },
    { value: openTasks, label: "Demandas em aberto" },
    { value: activeProjects, label: "Projetos ativos" },
    { value: contactDueCount, label: "Contatos pendentes" },
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
  const eventDeadlines = upcomingEvents().map((i) => ({ title: i.title, date: i.date, time: i.time, overdue: false, kind: "Evento" }));
  const deadlines = [...projectDeadlines, ...eventDeadlines].sort((a, b) => `${a.date}T${a.time || "23:59"}`.localeCompare(`${b.date}T${b.time || "23:59"}`)).slice(0, 6);

  $("#dash-deadlines-empty").classList.toggle("hidden", deadlines.length > 0);
  $("#dash-deadlines-list").innerHTML = deadlines.map((item) => `
    <div class="list-item">
      <div class="list-item-main">
        <span class="list-item-title">${escapeHtml(item.title)}</span>
        <span class="list-item-date">${item.kind} · ${fmtDate(new Date(item.date + "T00:00:00"))}${item.time ? ` às ${item.time}` : ""}</span>
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
  renderInsights();
}

/* =========================================================
   INSIGHTS — indicadores derivados dos dados já carregados
========================================================= */
function insightDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return tsToDate(value);
}

function completionDate(item) {
  const explicit = insightDate(item.completedAt);
  if (explicit) return explicit;
  const completedLog = (item.progressLog || [])
    .filter((entry) => Number(entry.percent) >= 100 && insightDate(entry.date))
    .sort((a, b) => insightDate(a.date) - insightDate(b.date))[0];
  return completedLog ? insightDate(completedLog.date) : (insightDate(item.updatedAt) || insightDate(item.createdAt));
}

function renderInsights() {
  const root = $("#view-insights");
  if (!root || !currentUser) return;

  const periodValue = $("#insights-period").value;
  const now = new Date();
  const start = periodValue === "all" ? null : new Date(now.getTime() - Number(periodValue) * 86400000);
  const inPeriod = (date) => {
    const parsed = insightDate(date);
    return parsed && (!start || parsed >= start) && parsed <= now;
  };
  const createdCollections = [...diaryItems, ...ahsdItems, ...kanbanItems, ...projectItems, ...goalItems];
  const createdCount = createdCollections.filter((item) => inPeriod(item.createdAt)).length;
  const completed = [
    ...kanbanItems.filter((item) => item.status === "done"),
    ...projectItems.filter((item) => item.status === "Concluido" || Number(item.progress) >= 100),
    ...goalItems.filter((item) => item.status === "Concluida" || Number(item.progress) >= 100),
  ];
  const completedInPeriod = completed.filter((item) => inPeriod(completionDate(item)));
  const productivityEvents = [
    ...createdCollections.map((item) => ({ date: insightDate(item.createdAt), kind: "criado", weight: 1 })),
    ...completed.map((item) => ({ date: completionDate(item), kind: "concluído", weight: 2 })),
    ...habitItems.flatMap((habit) => (habit.completions || []).map((date) => ({ date: new Date(date + "T12:00:00"), kind: "hábito", weight: 1 }))),
  ].filter((event) => event.date);
  const dayKey = (date) => { const parsed = insightDate(date); return parsed ? `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,"0")}-${String(parsed.getDate()).padStart(2,"0")}` : ""; };
  const dayScores = productivityEvents.reduce((scores, event) => { const key = dayKey(event.date); scores[key] = (scores[key] || 0) + event.weight; return scores; }, {});

  const completionDurations = completedInPeriod.map((item) => {
    const created = insightDate(item.createdAt);
    const done = completionDate(item);
    return created && done && done >= created ? (done - created) / 86400000 : null;
  }).filter((value) => value !== null);
  const avgCompletion = completionDurations.length
    ? completionDurations.reduce((sum, value) => sum + value, 0) / completionDurations.length
    : null;

  const habitScores = habitItems.map((habit) => {
    const habitCreated = insightDate(habit.createdAt);
    const effectiveStart = start && habitCreated ? new Date(Math.max(start, habitCreated)) : (habitCreated || start || new Date(now.getTime() - 365 * 86400000));
    const effectiveDays = Math.max(1, Math.ceil((now - effectiveStart) / 86400000) + 1);
    const actual = (habit.completions || []).filter((date) => inPeriod(date + "T23:59:59") && (!habitCreated || new Date(date + "T23:59:59") >= habitCreated)).length;
    const target = Math.max(1, Number(habit.target) || 1);
    const expected = habit.frequency === "diario" ? effectiveDays : habit.frequency === "semanal" ? (effectiveDays / 7) * target : (effectiveDays / 30.44) * target;
    return { ...habit, actual, score: Math.min(100, Math.round((actual / Math.max(1, expected)) * 100)) };
  }).sort((a, b) => b.score - a.score);
  const habitConsistency = habitScores.length ? Math.round(habitScores.reduce((sum, habit) => sum + habit.score, 0) / habitScores.length) : null;
  const avgGoalProgress = goalItems.length ? Math.round(goalItems.reduce((sum, goal) => sum + (Number(goal.progress) || 0), 0) / goalItems.length) : null;

  const kpis = [
    { code: "PROD", value: createdCount, label: "itens criados no período", color: "var(--primary-2)", soft: "var(--primary-soft)" },
    { code: "FEITO", value: completedInPeriod.length, label: "entregas concluídas", color: "var(--teal)", soft: "var(--teal-soft)" },
    { code: "RITMO", value: avgCompletion === null ? "—" : avgCompletion < 1 ? "<1d" : `${Math.round(avgCompletion)}d`, label: "tempo médio de conclusão", color: "var(--amber)", soft: "var(--amber-soft)" },
    { code: "HÁBITOS", value: habitConsistency === null ? "—" : `${habitConsistency}%`, label: "consistência média", color: "var(--rust)", soft: "var(--rust-soft)" },
  ];
  $("#insights-kpis").innerHTML = kpis.map((kpi) => `
    <article class="glass-card insight-kpi" style="--kpi-color:${kpi.color};--kpi-soft:${kpi.soft}">
      <span class="insight-kpi-icon">${kpi.code}</span><strong class="insight-kpi-value">${kpi.value}</strong><span class="insight-kpi-label">${kpi.label}</span>
    </article>`).join("");

  const monthCount = periodValue === "30" ? 3 : periodValue === "90" ? 4 : periodValue === "180" ? 6 : 12;
  const months = Array.from({ length: monthCount }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (monthCount - 1 - index), 1);
    return { date, key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`, created: 0, completed: 0 };
  });
  const monthByDate = (date) => {
    const parsed = insightDate(date);
    return parsed ? `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}` : "";
  };
  createdCollections.forEach((item) => { const month = months.find((entry) => entry.key === monthByDate(item.createdAt)); if (month) month.created += 1; });
  completed.forEach((item) => { const month = months.find((entry) => entry.key === monthByDate(completionDate(item))); if (month) month.completed += 1; });
  const maxMonthly = Math.max(1, ...months.flatMap((month) => [month.created, month.completed]));
  $("#insights-monthly-chart").innerHTML = months.map((month) => `
    <div class="month-column">
      <div class="month-bars">
        <span class="month-bar created" title="${month.created} criado(s)" style="height:${Math.max(2, month.created / maxMonthly * 100)}%"></span>
        <span class="month-bar completed" title="${month.completed} concluído(s)" style="height:${Math.max(2, month.completed / maxMonthly * 100)}%"></span>
      </div>
      <span class="month-label">${new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(month.date).replace(".", "")}</span>
      <span class="month-total">${month.created} / ${month.completed}</span>
    </div>`).join("");

  const taskCounts = [
    { label: "A fazer", count: kanbanItems.filter((item) => (item.status || "todo") === "todo").length, color: "var(--plum)" },
    { label: "Em progresso", count: kanbanItems.filter((item) => item.status === "doing").length, color: "var(--amber)" },
    { label: "Concluídas", count: kanbanItems.filter((item) => item.status === "done").length, color: "var(--teal)" },
  ];
  const taskTotal = taskCounts.reduce((sum, item) => sum + item.count, 0);
  let cursor = 0;
  const donutStops = taskCounts.map((item) => { const startDeg = cursor; cursor += taskTotal ? item.count / taskTotal * 360 : 0; return `${item.color} ${startDeg}deg ${cursor}deg`; }).join(",");
  $("#insights-task-status").innerHTML = taskTotal ? `
    <div class="status-donut" style="background:conic-gradient(${donutStops})"><div class="status-donut-center"><div><strong>${taskTotal}</strong><span>demandas</span></div></div></div>
    <div class="status-legend">${taskCounts.map((item) => `<div class="status-legend-row"><i class="legend-dot" style="background:${item.color}"></i><span>${item.label}</span><strong>${item.count}</strong></div>`).join("")}</div>`
    : `<div class="insights-empty">Cadastre demandas para visualizar o fluxo.</div>`;

  $("#insights-habits").innerHTML = habitScores.length ? habitScores.slice(0, 6).map((habit) => `
    <div class="insight-rank-row"><span class="insight-rank-name" title="${escapeHtml(habit.title)}">${escapeHtml(habit.emoji || "↻")} ${escapeHtml(habit.title)}</span><span class="insight-rank-track"><span class="insight-rank-fill" style="width:${habit.score}%"></span></span><span class="insight-rank-value">${habit.score}%</span></div>`).join("")
    : `<div class="insights-empty">Cadastre hábitos para acompanhar sua consistência.</div>`;

  const rankedGoals = [...goalItems].sort((a, b) => (Number(b.progress) || 0) - (Number(a.progress) || 0)).slice(0, 6);
  $("#insights-goals").innerHTML = rankedGoals.length ? rankedGoals.map((goal) => `
    <div class="insight-rank-row"><span class="insight-rank-name" title="${escapeHtml(goal.title)}">${escapeHtml(goal.title)}</span><span class="insight-rank-track"><span class="insight-rank-fill goal" style="width:${Number(goal.progress) || 0}%"></span></span><span class="insight-rank-value">${Number(goal.progress) || 0}%</span></div>`).join("")
    : `<div class="insights-empty">Cadastre metas para visualizar sua evolução.</div>`;

  const heatDays = Array.from({ length: 112 }, (_, index) => { const date = new Date(now); date.setHours(12,0,0,0); date.setDate(date.getDate() - (111-index)); return { date, score: dayScores[dayKey(date)] || 0 }; });
  const maxDayScore = Math.max(1, ...heatDays.map((day) => day.score));
  $("#productivity-heatmap").innerHTML = heatDays.map((day) => `<span class="productivity-cell level-${day.score ? Math.max(1, Math.ceil(day.score/maxDayScore*4)) : 0}" title="${fmtDate(day.date)} · ${day.score} ponto(s)"></span>`).join("");
  const last7Score = heatDays.slice(-7).reduce((sum, day) => sum + day.score, 0); $("#productivity-score").textContent = `Score semanal ${Math.min(100, last7Score * 5)}/100`;
  $("#dash-productivity-heatmap").innerHTML=$("#productivity-heatmap").innerHTML; $("#dash-productivity-caption").textContent=`Score semanal ${Math.min(100,last7Score*5)}/100 · ${heatDays.slice(-7).filter((day)=>day.score).length}/7 dias ativos`; const widgetVisible=localStorage.getItem("nova-productivity-widget")!=="hidden"; $("#dash-productivity-widget").classList.toggle("hidden",!widgetVisible); $("#productivity-widget-toggle").textContent=widgetVisible?"Ocultar widget do Dashboard":"Mostrar widget no Dashboard";
  const weekdays = Array.from({length:7},(_,day)=>({day,count:0})); productivityEvents.filter((event)=>inPeriod(event.date)).forEach((event)=>weekdays[event.date.getDay()].count += event.weight); const maxWeekday=Math.max(1,...weekdays.map((item)=>item.count)); const weekdayNames=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  $("#weekday-productivity").innerHTML=weekdays.map((item)=>`<div><span class="weekday-bar"><i style="height:${item.count/maxWeekday*100}%"></i></span><b>${weekdayNames[item.day]}</b><small>${item.count}</small></div>`).join("");
  const rangeDays = periodValue === "all" ? 365 : Number(periodValue); const previousStart = new Date(now.getTime()-rangeDays*2*86400000); const currentStart = new Date(now.getTime()-rangeDays*86400000); const currentEvents=productivityEvents.filter((event)=>event.date>=currentStart).reduce((sum,event)=>sum+event.weight,0); const previousEvents=productivityEvents.filter((event)=>event.date>=previousStart&&event.date<currentStart).reduce((sum,event)=>sum+event.weight,0); const variation=previousEvents?Math.round((currentEvents-previousEvents)/previousEvents*100):(currentEvents?100:0);
  $("#period-comparison").innerHTML=`<strong class="comparison-value ${variation>=0?"up":"down"}">${variation>=0?"+":""}${variation}%</strong><p>${currentEvents} pontos agora contra ${previousEvents} no período anterior.</p>`;
  const productivityContextEntries=diaryItems.filter((entry)=>inPeriod(entry.createdAt)&&(entry.energy!=null||entry.sleepHours)); const activityForDiary=(entry)=>dayScores[dayKey(entry.createdAt)]||0; const highEnergy=productivityContextEntries.filter((entry)=>Number(entry.energy)>=4); const lowEnergy=productivityContextEntries.filter((entry)=>Number(entry.energy)<=2); const avgActivity=(entries)=>entries.length?(entries.reduce((sum,entry)=>sum+activityForDiary(entry),0)/entries.length).toFixed(1):null; const highActivity=avgActivity(highEnergy), lowActivity=avgActivity(lowEnergy);
  $("#context-correlation").innerHTML=productivityContextEntries.length?`<div class="correlation-row"><span>Energia alta</span><strong>${highActivity||"—"} pts/dia</strong></div><div class="correlation-row"><span>Energia baixa</span><strong>${lowActivity||"—"} pts/dia</strong></div><p>${highActivity&&lowActivity?(Number(highActivity)>=Number(lowActivity)?"Seus dias de energia alta concentram mais atividade.":"Sua atividade não depende apenas da energia registrada."):"Continue registrando contexto para melhorar a comparação."}</p>`:`<div class="insights-empty">Registre energia no Diário para calcular correlações.</div>`;
  const weekCreated=createdCollections.filter((item)=>{const date=insightDate(item.createdAt);return date&&date>=new Date(now.getTime()-7*86400000);}).length; const weekCompleted=completed.filter((item)=>{const date=completionDate(item);return date&&date>=new Date(now.getTime()-7*86400000);}).length; const activeDays=heatDays.slice(-7).filter((day)=>day.score>0).length;
  const currentOpenEffort=kanbanItems.filter((task)=>task.status!=="done").reduce((sum,task)=>sum+(Number(task.effort)||3),0); $("#weekly-summary").innerHTML=`<strong>${activeDays}/7 dias ativos</strong><p>${weekCreated} item(ns) criado(s), ${weekCompleted} conclusão(ões) e ${last7Score} pontos de produtividade.</p>${activeDays<=2?`<span class="productivity-alert">Ritmo baixo: escolha uma próxima ação pequena.</span>`:currentOpenEffort>40?`<span class="productivity-alert">Carga alta: ${currentOpenEffort} pontos em demandas abertas.</span>`:`<span class="productivity-good">Ritmo sustentável nesta semana.</span>`}`;

  const completionRate = createdCount ? Math.round(completedInPeriod.length / createdCount * 100) : 0;
  const bestHabit = habitScores[0];
  const activeGoals = goalItems.filter((goal) => goal.status !== "Concluida");
  const activeInsightProjects = projectItems.filter((project) => project.status !== "Concluido");
  const projectsAtRisk = activeInsightProjects.filter((project) => (project.risks || []).length || (project.hoursEstimated > 0 && project.hoursSpent > project.hoursEstimated));
  const projectsWithoutAction = activeInsightProjects.filter((project) => !project.nextAction).length;
  const openInsightTasks = kanbanItems.filter((task) => task.status !== "done");
  const openEffort = openInsightTasks.reduce((sum, task) => sum + (Number(task.effort) || 3), 0);
  const overdueTasks = openInsightTasks.filter((task) => task.deadline && task.deadline < now.toISOString().slice(0, 10)).length;
  const contextualEntries = diaryItems.filter((entry) => inPeriod(entry.createdAt) && (entry.energy != null || entry.sleepHours || entry.mood));
  const energyEntries = contextualEntries.filter((entry) => entry.energy != null);
  const avgEnergy = energyEntries.length ? (energyEntries.reduce((sum, entry) => sum + Number(entry.energy), 0) / energyEntries.length).toFixed(1) : null;
  const sleepEntries = contextualEntries.filter((entry) => entry.sleepHours);
  const avgSleep = sleepEntries.length ? (sleepEntries.reduce((sum, entry) => sum + Number(entry.sleepHours), 0) / sleepEntries.length).toFixed(1) : null;
  const moodCounts = contextualEntries.reduce((counts, entry) => { if (entry.mood) counts[entry.mood] = (counts[entry.mood] || 0) + 1; return counts; }, {});
  const frequentMood = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const literaryItems = diaryItems.filter((entry) => ["Capítulo", "Cena", "Personagem", "Plot", "Trama", "Nota de Pesquisa", "Local", "Objeto"].includes(entry.category));
  const peopleWithContact = birthdayItems.filter((person) => person.email || person.phone || person.category);
  const relationshipDue = peopleWithContact.filter((person) => !person.lastContact || Math.floor((now - new Date(person.lastContact + "T00:00:00")) / 86400000) >= (person.contactFrequencyDays || 30));
  $("#insights-summary").innerHTML = `
    <div class="insight-summary-item"><span class="insight-summary-emoji">✓</span><strong>${completionRate}% de conversão</strong><br>${completedInPeriod.length} conclusão(ões) para ${createdCount} novo(s) item(ns) no período.</div>
    <div class="insight-summary-item"><span class="insight-summary-emoji">↻</span>${bestHabit ? `<strong>${escapeHtml(bestHabit.title)}</strong><br>É seu hábito mais consistente, com ${bestHabit.score}% de aderência.` : "Cadastre hábitos para descobrir seu ritmo mais consistente."}</div>
    <div class="insight-summary-item"><span class="insight-summary-emoji">◎</span>${avgGoalProgress === null ? "Cadastre metas para acompanhar sua evolução." : `<strong>${avgGoalProgress}% de progresso médio</strong><br>em ${activeGoals.length} meta(s) ainda ativa(s).`}</div>
    <div class="insight-summary-item"><span class="insight-summary-emoji">▣</span>${activeInsightProjects.length ? `<strong>${projectsAtRisk.length} projeto(s) em atenção</strong><br>${projectsWithoutAction} sem próxima ação definida.` : "Cadastre projetos para acompanhar riscos e execução."}</div>
    <div class="insight-summary-item"><span class="insight-summary-emoji">▤</span><strong>${openEffort} pontos em aberto</strong><br>${overdueTasks} demanda(s) atrasada(s) em ${openInsightTasks.length} ativa(s).</div>
    <div class="insight-summary-item"><span class="insight-summary-emoji">☀</span>${contextualEntries.length ? `<strong>Energia média ${avgEnergy || "—"}/5</strong><br>${avgSleep ? `${avgSleep}h de sono · ` : ""}${frequentMood ? `humor mais frequente: ${escapeHtml(frequentMood)}.` : `${contextualEntries.length} registro(s) contextual(is).`}` : "Registre humor, energia e sono no Diário para revelar padrões pessoais."}</div>
    <div class="insight-summary-item"><span class="insight-summary-emoji">✦</span><strong>${literaryItems.length} elementos literários</strong><br>${literaryItems.filter((item) => item.maturity === "Pronta").length} ideia(s) pronta(s) em ${new Set(literaryItems.map((item) => item.book).filter(Boolean)).size} obra(s).</div>
    <div class="insight-summary-item"><span class="insight-summary-emoji">♙</span><strong>${relationshipDue.length} contatos pendentes</strong><br>${peopleWithContact.length} pessoa(s) com perfil de relacionamento.</div>`;
}

$("#insights-period").addEventListener("change", renderInsights);
$("#productivity-widget-toggle").addEventListener("click",()=>{ const visible=$("#dash-productivity-widget").classList.contains("hidden"); localStorage.setItem("nova-productivity-widget",visible?"visible":"hidden"); renderInsights(); });
$("#insights-export").addEventListener("click", () => { const rows=[["modulo","titulo","status","progresso","criado_em","concluido_em"],...diaryItems.map((item)=>["diario",item.title,item.status||"","",insightDate(item.createdAt)?.toISOString()||"",""]),...kanbanItems.map((item)=>["demandas",item.title,item.status||"",item.effort||"",insightDate(item.createdAt)?.toISOString()||"",completionDate(item)?.toISOString()||""]),...projectItems.map((item)=>["projetos",item.title,item.status||"",item.progress||0,insightDate(item.createdAt)?.toISOString()||"",item.status==="Concluido"?completionDate(item)?.toISOString()||"":""]),...goalItems.map((item)=>["metas",item.title,item.status||"",item.progress||0,insightDate(item.createdAt)?.toISOString()||"",item.status==="Concluida"?completionDate(item)?.toISOString()||"":""])]; const csv=rows.map((row)=>row.map((value)=>`"${String(value??"").replace(/"/g,`""`)}"`).join(",")).join("\n"); const url=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"})); const link=document.createElement("a"); link.href=url; link.download=`nova-insights-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(url); showToast("CSV exportado."); });

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

  // Demandas pendentes
  const todoCount = kanbanItems.filter((i) => (i.status || "todo") === "todo").length;
  const doingCount = kanbanItems.filter((i) => i.status === "doing").length;
  const totalOpen = todoCount + doingCount;
  if (totalOpen > 0) {
    items.push({ icon: "📋", priority: 8, text: `Você tem <strong>${totalOpen} demanda(s)</strong> em aberto (${todoCount} para fazer, ${doingCount} em progresso).` });
  } else {
    items.push({ icon: "✅", priority: 5, text: "Nenhuma demanda pendente no momento." });
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
    items.push({ icon: "⏸️", priority: 9, text: `<strong>${stalledProjects.length} projeto(s)</strong> parado(s) há um tempo: ${escapeHtml(names)}${stalledProjects.length > 3 ? "…" : ""}.` });
  }

  // Próximo aniversário
  const nextBday = upcomingBirthdays(1)[0];
  if (nextBday) {
    items.push(nextBday.isToday
      ? { icon: "🎉", priority: 9, text: `Hoje é aniversário de <strong>${escapeHtml(nextBday.name)}</strong>!` }
      : { icon: "🎂", priority: nextBday.daysLeft <= 7 ? 7 : 3, text: `Faltam <strong>${nextBday.daysLeft} dia(s)</strong> para o aniversário de ${escapeHtml(nextBday.name)}.` });
  }

  // Próximo prazo (projeto ou evento)
  const projectDeadlines = projectItems.filter((p) => p.deadline && p.status !== "Concluido").map((p) => ({ title: p.title, date: p.deadline, time: null, kind: "projeto" }));
  const eventDeadlines = upcomingEvents().map((e) => ({ title: e.title, date: e.date, time: e.time, kind: "evento" }));
  const nextDeadline = [...projectDeadlines, ...eventDeadlines].sort((a, b) => `${a.date}T${a.time || "23:59"}`.localeCompare(`${b.date}T${b.time || "23:59"}`))[0];
  if (nextDeadline) {
    const deadlineAt = new Date(`${nextDeadline.date}T${nextDeadline.time || "23:59"}:00`);
    const minutes = Math.ceil((deadlineAt - new Date()) / 60000);
    let when;
    if (nextDeadline.time) {
      const days = Math.floor(minutes / 1440);
      if (minutes < 0) when = "está atrasado";
      else if (minutes < 60) when = `vence em ${minutes} min`;
      else if (minutes < 1440) when = `vence em ${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}min` : ""}`;
      else if (days === 1) when = `é amanhã às ${nextDeadline.time}`;
      else when = `é em ${days} dias, às ${nextDeadline.time}`;
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dueDay = new Date(`${nextDeadline.date}T00:00:00`);
      const days = Math.round((dueDay - today) / 86400000);
      if (days < 0) when = "está atrasado";
      else if (days === 0) when = nextDeadline.kind === "evento" ? "é hoje (sem horário)" : "vence hoje";
      else if (days === 1) when = "é amanhã";
      else when = `é em ${days} dias`;
    }
    items.push({ icon: "⏰", priority: 10, text: `Próximo prazo: <strong>${escapeHtml(nextDeadline.title)}</strong> (${nextDeadline.kind}) ${when}.` });
  }

  // Última anotação do diário
  const lastDiary = [...diaryItems].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))[0];
  if (lastDiary) {
    const ts = tsToDate(lastDiary.updatedAt) || tsToDate(lastDiary.createdAt);
    items.push({ icon: "📓", priority: 1, text: `Sua última anotação no diário foi <strong>${relativeTime(ts)}</strong>: "${escapeHtml(lastDiary.title)}".` });
  }

  // Última observação AH/SD
  const lastAhsd = [...ahsdItems].sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime))[0];
  if (lastAhsd) {
    items.push({ icon: "🧠", priority: 1, text: `Última observação AH/SD registrada <strong>${relativeTime(new Date(lastAhsd.dateTime))}</strong>.` });
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
  items.push({ icon: "💡", priority: 6, text: suggestion, suggestion: true });

  return items.sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

let dailyBriefExpanded = false;
function renderDailyBrief() {
  if (!currentUser) return;
  const items = buildDailyBrief();
  const visibleItems = dailyBriefExpanded ? items : items.slice(0, 4);
  $("#daily-brief-list").innerHTML = visibleItems.map((i) => `
    <div class="brief-item ${i.suggestion ? "brief-suggestion" : ""}">
      <span class="brief-icon">${i.icon}</span>
      <span class="brief-text">${i.text}</span>
    </div>
  `).join("");
  const toggle = $("#daily-brief-toggle");
  toggle.classList.toggle("hidden", items.length <= 4);
  toggle.textContent = dailyBriefExpanded ? "Ver menos" : `Ver tudo (${items.length})`;
}

$("#daily-brief-toggle").addEventListener("click", () => {
  dailyBriefExpanded = !dailyBriefExpanded;
  renderDailyBrief();
});

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
  } else if (e.key === "Escape") {
    const openForm = $(".form-card:not(.hidden)"); if (openForm && (!formDirty || confirm("Descartar alterações não salvas?"))) { openForm.classList.add("hidden"); formDirty = false; }
  } else if (e.key === "/" && !["INPUT","TEXTAREA","SELECT"].includes(document.activeElement.tagName)) {
    e.preventDefault(); if (currentUser) openCmdk();
  } else if (e.altKey && /^[0-9]$/.test(e.key)) {
    const views = ["dashboard","diario","literatura","ahsd","kanban","projetos","metas","habitos","agenda","pessoas"]; const index = e.key === "0" ? 9 : Number(e.key)-1; if (views[index]) { e.preventDefault(); switchView(views[index]); }
  } else if (e.key.toLowerCase() === "n" && !["INPUT","TEXTAREA","SELECT"].includes(document.activeElement.tagName)) {
    const active = $(".view.active")?.id.replace("view-",""); const newButtons = { diario:"#diario-new-btn", literatura:"#literatura-new-btn", kanban:"#kanban-new-btn", projetos:"#projeto-new-btn", metas:"#meta-new-btn", habitos:"#habito-new-btn", agenda:"#evento-new-btn", pessoas:"#pessoa-new-btn", ahsd:"#ahsd-new-btn" }; if (newButtons[active]) { e.preventDefault(); $(newButtons[active]).click(); }
  }
});

let formDirty = false;
document.addEventListener("input", (event) => { if (event.target.closest(".form-card")) formDirty = true; }); document.addEventListener("change", (event) => { if (event.target.closest(".form-card")) formDirty = true; });
document.addEventListener("click", (event) => { if (event.target.matches("[id$=save-btn], #pessoa-save")) formDirty = false; });
window.addEventListener("beforeunload", (event) => { if (formDirty) { event.preventDefault(); event.returnValue = ""; } });

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
  const rows = [
    ...info.events.map((e) => ({ color: "var(--rust)", label: e.time ? `Evento · ${e.time}` : "Evento · sem horário", text: e.title })),
    ...info.bdays.map((b) => ({ color: "var(--plum)", label: "Aniversário", text: `${b.name} 🎂` })),
    ...info.deadlines.map((p) => ({ color: "var(--teal)", label: "Prazo", text: p.title })),
  ];
  panel.innerHTML = `
    <div class="cal-day-details-head">
      <p class="cal-day-details-title">${fmtDate(dateObj)}</p>
      <button type="button" class="btn btn-primary btn-sm" id="cal-create-event">+ Criar evento</button>
    </div>
    ${total ? "" : `<p class="cal-day-empty">Nenhum compromisso nesta data. Deseja planejar algo?</p>`}
    ${rows.map((r) => `
      <div class="cal-day-detail-item">
        <span class="cal-dot" style="background:${r.color}"></span>
        <span>${escapeHtml(r.text)}</span>
        <span style="margin-left:auto; color:var(--ink-faint); font-size:0.7rem;">${r.label}</span>
      </div>
    `).join("")}
  `;
  $("#cal-create-event").addEventListener("click", () => {
    switchView("agenda");
    startNewEvent(ymd(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));
  });
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
      <button type="button" class="cal-day ${otherMonth ? "other-month" : ""} ${isToday ? "today" : ""} ${isSelected ? "selected" : ""} ${hasEvents ? "has-events" : ""}"
           data-date="${cellStr}" ${titleParts.length ? `title="${escapeHtml(titleParts.join(" · "))}"` : ""}>
        <span>${cellDate.getDate()}</span>
        <span class="cal-day-dots">${dots}</span>
      </button>
    `;
  }
  $("#cal-grid").innerHTML = cellsHtml;

  $$(".cal-day", $("#cal-grid")).forEach((cell) => {
    cell.addEventListener("click", () => {
      selectedCalendarDay = cell.dataset.date;
      const [selectedYear, selectedMonth] = selectedCalendarDay.split("-").map(Number);
      if (selectedYear !== year || selectedMonth - 1 !== month) {
        calendarViewDate = new Date(selectedYear, selectedMonth - 1, 1);
      }
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
