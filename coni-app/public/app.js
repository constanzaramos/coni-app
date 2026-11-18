import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, setDoc,
  onSnapshot, query, orderBy, serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, API_BASE } from "./firebase-config.js";
import {
  NUTRIENTS, KEYS, SLOTS, SEED_FOODS, DEFAULT_PROFILE, normalize, requirements,
  itemNutrients, sumItems, adequacy, macroSplit, parsePlan, claudePrompt,
} from "./nutri.js";

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

/* =========================================================
   Estado
   ========================================================= */
const COLS = ["tasks", "goals", "sessions", "intake", "foods", "shopping", "clients", "projects", "settings"];
const data = Object.fromEntries(COLS.map((c) => [c, []]));
let uid = null;
let unsubs = [];
let pendingRender = false;

const ui = {
  view: "hoy",
  taskFilter: "pend",
  comidaTab: "dia",
  day: null,          // fecha seleccionada en Comida › Día
  weekOffset: 0,      // Comida › Semana
  rango: "dia",       // Comida › Análisis
  mes: null,          // Casa
  gastoCat: "",       // categoría precargada en el formulario de gastos
};

// Datos que vienen de Notion (vía /api/notion)
const nt = {
  coramba: null, corambaAt: 0, corambaErr: null, corambaLoading: false,
  gastos: {}, gastosErr: null, gastosLoading: false,
};

const TITLES = { hoy: "Hoy", gestiones: "Gestiones", estudio: "Estudio", comida: "Alimentación", coramba: "Coramba", casa: "Casa" };
const CLIENT_STATUS = ["prospecto", "activo", "cerrado"];
const PROJECT_STATUS = ["por iniciar", "en curso", "entregado"];
const NOTION_ESTADOS = {
  puesta: ["Pendiente", "En curso", "Hecho"],
  shopify: ["Por hacer", "En curso", "En revisión", "Hecho"],
};
const CATEGORIAS = [
  "Gastos comunes", "Luz", "Agua", "Gas", "Internet y streaming", "Supermercado y feria",
  "Aseo y hogar", "Mantención y reparaciones", "Muebles y equipamiento", "Salidas juntos", "Mascota", "Imprevistos",
];
const BASICOS = ["Gastos comunes", "Luz", "Agua", "Gas", "Internet y streaming"];
const FIJOS = new Set(["Gastos comunes", "Internet y streaming"]);
// Igual que en Notion: "Proporcional = 29% Coni / 71% David"
const SHARE_CONI = { "Proporcional": 0.29, "50/50": 0.5, "Solo Coni": 1, "Solo David": 0 };

const STUDY_TEMPLATES = {
  hsk1: {
    title: "Chino · HSK 1", kind: "vocab", template: "hsk1",
    vocabTarget: 300, vocabLearned: 0, targetHours: 100, deadline: null,
    note: "HSK 3.0: 300 palabras. El nuevo examen rige desde el 13 dic 2026.",
  },
  google: {
    title: "Google Marketing Digital y E-commerce", kind: "cursos", template: "google",
    targetHours: 190, deadline: null, note: "Certificado profesional en Coursera · 8 cursos",
    courses: [
      ["Fundamentos del marketing digital y el e-commerce", 12],
      ["Atraer e involucrar clientes con marketing digital", 14],
      ["De los likes a los leads: interactuar con clientes", 21],
      ["Email marketing", 19],
      ["Analítica y medición de marketing", 18],
      ["Crear, lanzar y gestionar tiendas e-commerce", 15],
      ["Fidelización de clientes en línea", 15],
      ["Acelera tu búsqueda de empleo con IA", 6],
    ].map(([name, hours]) => ({ name, hours, done: false })),
  },
};

/* =========================================================
   Helpers
   ========================================================= */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const today = () => ymd(new Date());
const fmtDate = (s, opts = { weekday: "short", day: "numeric", month: "short" }) =>
  s ? new Date(s.slice(0, 10) + "T12:00").toLocaleDateString("es-CL", opts) : "";
const fmtMonth = (m) => new Date(m + "-15T12:00").toLocaleDateString("es-CL", { month: "long", year: "numeric" });
const clp = (n) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n || 0);
const num = (v, dec = 0) => Number(v || 0).toLocaleString("es-CL", { maximumFractionDigits: dec });
const hours = (min) => (min / 60).toLocaleString("es-CL", { maximumFractionDigits: 1 });
const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);
const next = (arr, v) => arr[(arr.indexOf(v) + 1) % arr.length];
const shiftDay = (s, n) => { const d = new Date(s + "T12:00"); d.setDate(d.getDate() + n); return ymd(d); };
const shiftMonth = (m, n) => { const d = new Date(m + "-15T12:00"); d.setMonth(d.getMonth() + n); return ymd(d).slice(0, 7); };
const weekDays = (offset = 0) => {
  const d = new Date(); d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() + i); return ymd(x); });
};
const bar = (p, cls = "") => `<div class="progress ${cls}"><div style="width:${p}%"></div></div>`;

/* =========================================================
   Firestore
   ========================================================= */
const col = (name) => collection(db, "users", uid, name);
const ref = (name, id) => doc(db, "users", uid, name, id);
const add = (name, obj) => addDoc(col(name), { ...obj, createdAt: serverTimestamp() });
const upd = (name, id, obj) => updateDoc(ref(name, id), obj);
const del = (name, id) => deleteDoc(ref(name, id));

function subscribe() {
  unsubs = COLS.map((name) => {
    const q = name === "settings" ? col(name) : query(col(name), orderBy("createdAt"));
    return onSnapshot(q, (snap) => {
      data[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    }, (err) => console.error(name, err));
  });
}

/* =========================================================
   Notion (vía función serverless)
   ========================================================= */
async function api(action, { body, params } = {}) {
  const token = await auth.currentUser.getIdToken();
  const qs = new URLSearchParams({ action, ...(params || {}) });
  const r = await fetch(`${API_BASE}/api/notion?${qs}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

async function loadCoramba(force = false) {
  if (nt.corambaLoading) return;
  if (!force && nt.coramba && Date.now() - nt.corambaAt < 120000) return;
  nt.corambaLoading = true; nt.corambaErr = null; render();
  try { nt.coramba = await api("coramba"); nt.corambaAt = Date.now(); }
  catch (e) { nt.corambaErr = e.message; }
  finally { nt.corambaLoading = false; render(); }
}

async function loadGastos(mes, force = false) {
  if (nt.gastosLoading) return;
  if (!force && nt.gastos[mes]) return;
  nt.gastosLoading = true; nt.gastosErr = null; render();
  try { nt.gastos[mes] = (await api("gastos", { params: { mes } })).gastos; }
  catch (e) { nt.gastosErr = e.message; }
  finally {
    nt.gastosLoading = false; render();
    // si cambiaste de mes mientras cargaba, carga el mes actual
    if (ui.view === "casa" && !nt.gastos[ui.mes] && !nt.gastosErr) loadGastos(ui.mes);
  }
}

/* =========================================================
   Auth
   ========================================================= */
onAuthStateChanged(auth, (user) => {
  $("#loading").hidden = true;
  unsubs.forEach((u) => u());
  unsubs = [];
  if (user) {
    uid = user.uid;
    ui.day = today();
    ui.mes = today().slice(0, 7);
    $("#login").hidden = true;
    $("#app").hidden = false;
    subscribe();
    go("hoy");
  } else {
    uid = null;
    $("#app").hidden = true;
    $("#login").hidden = false;
  }
});

$("#btn-login").addEventListener("click", async () => {
  const provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, provider);
    } else { alert("No se pudo iniciar sesión: " + e.message); }
  }
});
$("#btn-logout").addEventListener("click", () => signOut(auth));

/* =========================================================
   Componentes
   ========================================================= */
const areaChip = (a) => a && a !== "personal" ? `<span class="chip ${esc(a)}">${esc(a)}</span>` : "";
const list = (items, fn, emptyMsg) =>
  items.length ? `<ul class="list">${items.map(fn).join("")}</ul>` : `<p class="empty">${emptyMsg}</p>`;
const delBtn = (colName, id) => `<button class="icon" data-action="del" data-col="${colName}" data-id="${id}" aria-label="Eliminar">×</button>`;
const miniTabs = (action, current, opts) =>
  `<div class="tabs-mini">${opts.map(([k, label]) => `<button data-action="${action}" data-v="${k}" class="${current === k ? "active" : ""}">${label}</button>`).join("")}</div>`;

const taskItem = (t, showArea = false) => `
  <li class="item ${t.done ? "done" : ""}">
    <label>
      <input type="checkbox" data-action="toggle-task" data-id="${t.id}" ${t.done ? "checked" : ""}>
      <span class="t">${esc(t.title)}</span>
    </label>
    ${showArea ? areaChip(t.area) : ""}
    ${t.due ? `<small class="${!t.done && t.due < today() ? "late" : ""}">${fmtDate(t.due)}</small>` : ""}
    ${delBtn("tasks", t.id)}
  </li>`;

const taskForm = (area, withAreaSelect = false) => `
  <form class="inline" data-form="task" data-area="${area}">
    <input class="wide" name="title" placeholder="Nueva tarea…" required>
    <input type="date" name="due" value="${withAreaSelect ? today() : ""}">
    ${withAreaSelect ? `<select name="area">
      <option value="personal">Personal</option>
      <option value="casa">Casa</option>
      <option value="estudio">Estudio</option>
    </select>` : ""}
    <button class="btn primary">+</button>
  </form>`;

/* ---------- Estudio ---------- */
const goalMinutes = (goalId, from = null) =>
  data.sessions.filter((s) => s.goalId === goalId && (!from || s.date >= from)).reduce((a, s) => a + (s.minutes || 0), 0);

function goalProgress(g) {
  if (g.kind === "vocab") return { p: pct(g.vocabLearned || 0, g.vocabTarget), label: `${g.vocabLearned || 0} de ${g.vocabTarget} palabras` };
  if (g.kind === "cursos") {
    const cs = g.courses || [];
    const tot = cs.reduce((a, c) => a + c.hours, 0);
    const done = cs.filter((c) => c.done);
    return { p: pct(done.reduce((a, c) => a + c.hours, 0), tot), label: `${done.length} de ${cs.length} cursos` };
  }
  const min = goalMinutes(g.id);
  return { p: pct(min, (g.targetHours || 1) * 60), label: `${hours(min)} de ${g.targetHours} h` };
}

/* ---------- Alimentación ---------- */
const foodsById = () => Object.fromEntries(data.foods.map((f) => [f.id, f]));
const itemsOf = (date, kind, slot) =>
  data.intake.filter((i) => i.date === date && i.kind === kind && (!slot || i.slot === slot));
const profile = () => ({ ...DEFAULT_PROFILE, ...(data.settings.find((s) => s.id === "nutri") || {}) });
const req = () => requirements(profile());

function totalsForDays(days, kind) {
  const fbi = foodsById();
  const withData = days.filter((d) => itemsOf(d, kind).length);
  const t = sumItems(data.intake.filter((i) => i.kind === kind && withData.includes(i.date)), fbi);
  const n = withData.length || 1;
  return { avg: Object.fromEntries(KEYS.map((k) => [k, t[k] / n])), days: withData.length };
}

const intakeItem = (i, fbi) => {
  const n = itemNutrients(i, fbi);
  const missing = !fbi[i.foodId];
  return `<li class="item small">
    <div class="grow"><span>${esc(i.nombre)}</span><span class="sub">${num(i.grams)} g${missing ? " · sin datos" : ""}</span></div>
    <small>${num(n.kcal)} kcal</small>
    ${delBtn("intake", i.id)}
  </li>`;
};

/* ---------- Casa ---------- */
function gastoCalc(g) {
  const share = SHARE_CONI[g.reparto] ?? 0.29;
  const aporteConi = typeof g.aporteConi === "number" ? g.aporteConi : (g.monto || 0) * share;
  const aporteDavid = typeof g.aporteDavid === "number" ? g.aporteDavid : (g.monto || 0) - aporteConi;
  const balance = typeof g.balanceConi === "number" ? g.balanceConi
    : g.pagadoPor === "Coni" ? aporteDavid : g.pagadoPor === "David" ? -aporteConi : 0;
  return { aporteConi, aporteDavid, balance };
}

const notionBox = (loading, err, retryAction) => {
  if (err) return `<section class="card notice error"><b>No pude leer Notion.</b> <span>${esc(err)}</span>
    <button class="btn ghost small" data-action="${retryAction}">Reintentar</button></section>`;
  if (loading) return `<p class="empty">Cargando desde Notion…</p>`;
  return "";
};

/* =========================================================
   Vistas
   ========================================================= */
const views = {
  hoy() {
    const t = today();
    const pend = data.tasks.filter((x) => !x.done && x.due && x.due <= t).sort((a, b) => a.due.localeCompare(b.due));
    const sinFecha = data.tasks.filter((x) => !x.done && !x.due).length;
    const lunes = weekDays()[0];
    const minSemana = data.sessions.filter((s) => s.date >= lunes).reduce((a, s) => a + (s.minutes || 0), 0);
    const fbi = foodsById();
    const r = req();
    const realHoy = sumItems(itemsOf(t, "real"), fbi);
    const planHoy = sumItems(itemsOf(t, "plan"), fbi);
    const c = nt.coramba;
    const urgentes = c ? c.puesta.filter((x) => x.estado !== "Hecho" && (x.urgente || (x.fecha && x.fecha <= t))) : [];
    const agenda = c ? c.agenda.slice(0, 3) : [];
    const compras = data.shopping.filter((s) => !s.done).length;

    return `
      <div>
        <p class="hello">${fmtDate(t, { weekday: "long", day: "numeric", month: "long" })}</p>
        <div class="stats">
          <div class="stat"><b>${pend.length}</b><span>tareas para hoy</span></div>
          <div class="stat"><b>${hours(minSemana)} h</b><span>estudio esta semana</span></div>
          <div class="stat"><b>${num(realHoy.kcal)}${r ? `<small>/${num(r.kcal)}</small>` : ""}</b><span>kcal consumidas hoy</span></div>
          <div class="stat"><b>${c ? urgentes.length : "–"}</b><span>urgentes Coramba</span></div>
        </div>
      </div>

      <section class="card">
        <h2>Para hoy ${sinFecha ? `<small>${sinFecha} sin fecha</small>` : ""}</h2>
        ${list(pend, (x) => taskItem(x, true), "Nada pendiente para hoy 🌿")}
        ${taskForm("personal", true)}
      </section>

      <section class="card">
        <h2>Comidas de hoy <small><a href="#" data-action="goto-comida" data-v="dia">Registrar</a></small></h2>
        ${SLOTS.map((s) => {
          const p = itemsOf(t, "plan", s), rl = itemsOf(t, "real", s);
          if (!p.length && !rl.length) return "";
          return `<div class="meal"><b>${s}</b><span>${esc((rl.length ? rl : p).map((i) => i.nombre).join(", "))}</span>
            <small class="chip ${rl.length ? "ok" : "warn"}">${rl.length ? "registrado" : "planificado"}</small></div>`;
        }).join("") || `<p class="empty">Sin comidas planificadas para hoy.</p>`}
        ${planHoy.kcal || realHoy.kcal ? `<p class="sub mt">Plan ${num(planHoy.kcal)} kcal · Real ${num(realHoy.kcal)} kcal${r ? ` · Meta ${num(r.kcal)} kcal` : ""}</p>` : ""}
      </section>

      <section class="card">
        <h2>Estudio <small><a href="#" data-action="nav" data-view="estudio">Ver</a></small></h2>
        ${data.goals.length ? data.goals.map((g) => {
          const gp = goalProgress(g);
          return `<div class="goal-mini"><div class="row"><span>${esc(g.title)}</span><small>${gp.label}</small></div>${bar(gp.p)}</div>`;
        }).join("") : `<p class="empty">Agrega tus metas en Estudio.</p>`}
      </section>

      <section class="card">
        <h2>Coramba <small><a href="#" data-action="nav" data-view="coramba">Ver</a></small></h2>
        ${notionBox(nt.corambaLoading && !c, nt.corambaErr, "notion-refresh")}
        ${c ? `
          ${urgentes.length ? `<p class="label">Urgente o vencido</p>${list(urgentes.slice(0, 4), (x) => `<li class="item small"><div class="grow">${esc(x.tarea)}<span class="sub">${esc(x.area || "")}</span></div>${x.fecha ? `<small class="${x.fecha < t ? "late" : ""}">${fmtDate(x.fecha)}</small>` : ""}</li>`, "")}` : ""}
          <p class="label">Próximo en la agenda</p>
          ${list(agenda, (e) => `<li class="item small"><div class="grow">${esc(e.evento)}</div><small>${fmtDate(e.fecha)}</small></li>`, "Sin eventos próximos.")}
        ` : ""}
      </section>

      ${compras ? `<section class="card"><h2>Lista de compras <small><a href="#" data-action="goto-comida" data-v="compras">${compras} por comprar</a></small></h2></section>` : ""}
    `;
  },

  gestiones() {
    const mine = data.tasks.filter((x) => ["personal", "casa", undefined, null, ""].includes(x.area));
    const shown = mine.filter((x) => (ui.taskFilter === "pend" ? !x.done : x.done))
      .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
    return `
      <section class="card">
        ${miniTabs("filter", ui.taskFilter, [["pend", "Pendientes"], ["hechas", "Hechas"]])}
        ${list(shown, (x) => taskItem(x, true), ui.taskFilter === "pend" ? "Todo al día ✨" : "Aún no completas tareas.")}
        ${taskForm("personal", true)}
      </section>`;
  },

  estudio() {
    const lunes = weekDays()[0];
    const recientes = [...data.sessions].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 8);
    const estudioTasks = data.tasks.filter((x) => x.area === "estudio" && !x.done);
    const missing = Object.entries(STUDY_TEMPLATES).filter(([k]) => !data.goals.some((g) => g.template === k));

    return `
      ${missing.length ? `<section class="card soft"><h2>Agregar mis metas</h2><div class="btn-row">
        ${missing.map(([k, t]) => `<button class="btn ghost" data-action="add-template" data-v="${k}">＋ ${esc(t.title)}</button>`).join("")}
      </div></section>` : ""}

      ${data.goals.map((g) => {
        const gp = goalProgress(g);
        return `<section class="card">
          <h2>${esc(g.title)} ${delBtn("goals", g.id)}</h2>
          ${g.note ? `<p class="sub">${esc(g.note)}</p>` : ""}
          <div class="row mt"><b>${gp.p}%</b><small>${gp.label}</small></div>
          ${bar(gp.p)}
          <p class="sub mt">${hours(goalMinutes(g.id))} h estudiadas · ${hours(goalMinutes(g.id, lunes))} h esta semana${g.deadline ? ` · meta ${fmtDate(g.deadline)}` : ""}</p>

          ${g.kind === "vocab" ? `
            <div class="btn-row mt">
              <button class="btn ghost small" data-action="vocab" data-id="${g.id}" data-d="-1">−1</button>
              <button class="btn ghost small" data-action="vocab" data-id="${g.id}" data-d="1">+1</button>
              <button class="btn ghost small" data-action="vocab" data-id="${g.id}" data-d="5">+5</button>
              <button class="btn ghost small" data-action="vocab" data-id="${g.id}" data-d="10">+10</button>
              <span class="sub">palabras aprendidas</span>
            </div>` : ""}

          ${g.kind === "cursos" ? `<ul class="list mt">${(g.courses || []).map((c, i) => `
            <li class="item small ${c.done ? "done" : ""}"><label>
              <input type="checkbox" data-action="course" data-id="${g.id}" data-i="${i}" ${c.done ? "checked" : ""}>
              <span class="t">${i + 1}. ${esc(c.name)}</span></label><small>${c.hours} h</small></li>`).join("")}</ul>` : ""}

          <form class="inline" data-form="deadline" data-id="${g.id}">
            <label class="field">Fecha meta<input type="date" name="deadline" value="${g.deadline || ""}"></label>
            <button class="btn ghost small">Guardar</button>
          </form>
        </section>`;
      }).join("")}

      <section class="card">
        <h2>Registrar sesión</h2>
        ${data.goals.length ? `
        <form class="inline" data-form="session">
          <select name="goalId" class="wide" required>${data.goals.map((g) => `<option value="${g.id}">${esc(g.title)}</option>`).join("")}</select>
          <input type="number" name="minutes" min="5" step="5" placeholder="Minutos" required>
          <input type="date" name="date" value="${today()}" required>
          <button class="btn primary">Guardar</button>
        </form>` : `<p class="empty">Primero agrega una meta.</p>`}
        ${recientes.length ? `<ul class="list mt">${recientes.map((s) => `
          <li class="item small"><div class="grow">${esc(data.goals.find((g) => g.id === s.goalId)?.title || "Meta eliminada")}<span class="sub">${fmtDate(s.date)}</span></div>
          <small>${s.minutes} min</small>${delBtn("sessions", s.id)}</li>`).join("")}</ul>` : ""}
      </section>

      <section class="card">
        <h2>Otra meta</h2>
        <form class="inline" data-form="goal">
          <input class="wide" name="title" placeholder="Meta (ej: Curso de Firebase)" required>
          <input type="number" name="targetHours" min="1" placeholder="Horas meta" required>
          <input type="date" name="deadline">
          <button class="btn primary">+</button>
        </form>
      </section>

      <section class="card">
        <h2>Tareas de estudio</h2>
        ${list(estudioTasks, (x) => taskItem(x), "Sin tareas de estudio pendientes.")}
        ${taskForm("estudio")}
      </section>`;
  },

  comida() {
    const tabs = miniTabs("ctab", ui.comidaTab, [["dia", "Día"], ["semana", "Semana"], ["analisis", "Análisis"], ["alimentos", "Alimentos"], ["compras", "Compras"]]);
    return tabs + comida[ui.comidaTab]();
  },

  coramba() {
    const c = nt.coramba;
    const t = today();
    const head = `<div class="row"><span class="sub">${c ? `Desde Notion · ${new Date(nt.corambaAt).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}` : "Coramba OS en Notion"}</span>
      <button class="btn ghost small" data-action="notion-refresh">${nt.corambaLoading ? "Actualizando…" : "Actualizar"}</button></div>`;
    if (!c) return head + notionBox(nt.corambaLoading, nt.corambaErr, "notion-refresh") + clientesCobros();

    const pDone = c.puesta.filter((x) => x.estado === "Hecho").length;
    const sDone = c.shopify.filter((x) => x.estado === "Hecho").length;
    const hEst = c.shopify.reduce((a, x) => a + (x.horasEst || 0), 0);
    const hReal = c.shopify.reduce((a, x) => a + (x.horasReal || 0), 0);
    const pend = c.puesta.filter((x) => x.estado !== "Hecho")
      .sort((a, b) => (b.urgente - a.urgente) || (a.fecha || "9999").localeCompare(b.fecha || "9999"));
    const fases = [...new Set(c.shopify.map((x) => x.fase).filter(Boolean))].sort();
    const siguientes = c.shopify.filter((x) => x.estado !== "Hecho").slice(0, 6);
    const estadoBtn = (db, x) => `<button class="chip ${x.estado === "Hecho" ? "ok" : /curso|revisión/i.test(x.estado) ? "info" : "warn"}"
      data-action="notion-estado" data-db="${db}" data-id="${x.id}">${esc(x.estado || "—")}</button>`;
    const link = (x) => `<a class="icon" href="${esc(x.url)}" target="_blank" rel="noopener" aria-label="Abrir en Notion">↗</a>`;

    return `
      ${head}
      ${nt.corambaErr ? notionBox(false, nt.corambaErr, "notion-refresh") : ""}
      <div class="stats">
        <div class="stat"><b>${pct(pDone, c.puesta.length)}%</b><span>puesta en marcha (${pDone}/${c.puesta.length})</span></div>
        <div class="stat"><b>${pct(sDone, c.shopify.length)}%</b><span>sitio coramba.cl (${sDone}/${c.shopify.length})</span></div>
        <div class="stat"><b>${num(hReal, 1)}<small>/${num(hEst, 1)} h</small></b><span>horas reales vs estimadas</span></div>
        <div class="stat"><b>${c.agenda.length}</b><span>eventos próximos</span></div>
      </div>

      <section class="card">
        <h2>Puesta en marcha <small>toca el estado</small></h2>
        ${list(pend, (x) => `<li class="item">
          <div class="grow">${x.urgente ? "🔴 " : ""}${esc(x.tarea)}<span class="sub">${esc(x.area || "")}</span></div>
          ${x.fecha ? `<small class="${x.fecha < t ? "late" : ""}">${fmtDate(x.fecha)}</small>` : ""}
          ${estadoBtn("puesta", x)}${link(x)}</li>`, "¡Todo listo! 🎉")}
      </section>

      <section class="card">
        <h2>Sitio coramba.cl</h2>
        ${fases.map((f) => {
          const xs = c.shopify.filter((x) => x.fase === f);
          const d = xs.filter((x) => x.estado === "Hecho").length;
          return `<div class="goal-mini"><div class="row"><span>${esc(f)}</span><small>${d}/${xs.length}</small></div>${bar(pct(d, xs.length))}</div>`;
        }).join("")}
        <p class="label mt">Siguientes tareas</p>
        ${list(siguientes, (x) => `<li class="item">
          <div class="grow">${esc(x.tarea)}<span class="sub">${esc(x.fase || "")}${x.prioridad ? ` · prioridad ${esc(x.prioridad.toLowerCase())}` : ""}${x.horasEst ? ` · ${x.horasEst} h` : ""}</span></div>
          ${estadoBtn("shopify", x)}${link(x)}</li>`, "Sitio terminado 🎉")}
      </section>

      <section class="card">
        <h2>Agenda</h2>
        ${list(c.agenda.slice(0, 10), (e) => `<li class="item">
          <div class="grow">${esc(e.evento)}${e.notas ? `<span class="sub">${esc(e.notas)}</span>` : ""}</div>
          ${e.tipo ? `<span class="chip">${esc(e.tipo)}</span>` : ""}<small>${fmtDate(e.fecha)}</small>${link(e)}</li>`, "Sin eventos próximos.")}
      </section>

      ${clientesCobros()}`;
  },

  casa() {
    const mes = ui.mes;
    const gastos = nt.gastos[mes];
    const nav = `<div class="week-nav card">
      <button class="btn ghost small" data-action="mes" data-d="-1">‹</button>
      <h2 class="cap" style="margin:0">${fmtMonth(mes)}</h2>
      <button class="btn ghost small" data-action="mes" data-d="1">›</button></div>`;
    const form = gastoForm();
    if (!gastos) return nav + notionBox(nt.gastosLoading, nt.gastosErr, "gastos-refresh") + form;

    const total = gastos.reduce((a, g) => a + (g.monto || 0), 0);
    const fijos = gastos.filter((g) => g.tipo === "Fijo").reduce((a, g) => a + (g.monto || 0), 0);
    const calc = gastos.map(gastoCalc);
    const balance = calc.reduce((a, c) => a + c.balance, 0);
    const aporteConi = calc.reduce((a, c) => a + c.aporteConi, 0);
    const aporteDavid = calc.reduce((a, c) => a + c.aporteDavid, 0);
    const balTxt = Math.abs(balance) < 1 ? "Están a mano" : balance > 0 ? `David le transfiere ${clp(balance)} a Coni` : `Coni le transfiere ${clp(-balance)} a David`;
    const porCat = CATEGORIAS.map((cat) => [cat, gastos.filter((g) => g.categoria === cat).reduce((a, g) => a + (g.monto || 0), 0)])
      .filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const maxCat = porCat[0]?.[1] || 1;

    return `
      ${nav}
      ${nt.gastosErr ? notionBox(false, nt.gastosErr, "gastos-refresh") : ""}
      <div class="stats">
        <div class="stat"><b>${clp(total)}</b><span>gasto del mes</span></div>
        <div class="stat"><b>${clp(fijos)}</b><span>fijos · ${clp(total - fijos)} variables</span></div>
        <div class="stat"><b>${clp(aporteConi)}</b><span>le toca a Coni</span></div>
        <div class="stat"><b>${clp(aporteDavid)}</b><span>le toca a David</span></div>
      </div>
      <section class="card notice"><b>Cierre del mes:</b> ${balTxt}</section>

      <section class="card">
        <h2>Cuentas básicas</h2>
        <ul class="list">${BASICOS.map((cat) => {
          const gs = gastos.filter((g) => g.categoria === cat);
          const m = gs.reduce((a, g) => a + (g.monto || 0), 0);
          return `<li class="item"><div class="grow">${gs.length ? "✅" : "⬜"} ${cat}</div>
            ${gs.length ? `<small>${clp(m)}</small>` : `<button class="chip warn" data-action="gasto-cat" data-v="${cat}">Registrar</button>`}</li>`;
        }).join("")}</ul>
      </section>

      ${form}

      ${porCat.length ? `<section class="card"><h2>Por categoría</h2>
        ${porCat.map(([cat, v]) => `<div class="goal-mini"><div class="row"><span>${cat}</span><small>${clp(v)}</small></div>${bar(Math.round((v / maxCat) * 100), "alt")}</div>`).join("")}
      </section>` : ""}

      <section class="card">
        <h2>Gastos del mes <small>${gastos.length}</small></h2>
        ${list(gastos, (g) => `<li class="item">
          <div class="grow">${esc(g.concepto)}<span class="sub">${esc(g.categoria || "")} · pagó ${esc(g.pagadoPor || "—")} · ${esc(g.reparto || "")}</span></div>
          <small>${fmtDate(g.fecha, { day: "numeric", month: "short" })}</small><b class="amount">${clp(g.monto)}</b>
          <button class="icon" data-action="gasto-del" data-id="${g.id}" aria-label="Eliminar">×</button></li>`, "Sin gastos registrados este mes.")}
        <p class="sub mt">Se guardan en Notion › Nuestro Hogar › Gastos del hogar.</p>
      </section>`;
  },
};

function gastoForm() {
  const cat = ui.gastoCat || "Supermercado y feria";
  const defMes = ui.mes === today().slice(0, 7) ? today() : `${ui.mes}-01`;
  return `<section class="card" id="gasto-card">
    <h2>Nuevo gasto</h2>
    <form class="inline" data-form="gasto">
      <input class="wide" name="concepto" placeholder="Concepto (ej: Luz noviembre)" value="${ui.gastoCat ? esc(ui.gastoCat) : ""}" required>
      <input type="number" name="monto" min="1" step="1" placeholder="Monto CLP" inputmode="numeric" required>
      <input type="date" name="fecha" value="${defMes}" required>
      <select name="categoria">${CATEGORIAS.map((c) => `<option ${c === cat ? "selected" : ""}>${c}</option>`).join("")}</select>
      <select name="pagadoPor">${["Cuenta del hogar", "Coni", "David"].map((p) => `<option>${p}</option>`).join("")}</select>
      <select name="reparto">${Object.keys(SHARE_CONI).map((r) => `<option>${r}</option>`).join("")}</select>
      <select name="tipo">${["Fijo", "Variable"].map((t) => `<option ${(FIJOS.has(cat) ? "Fijo" : "Variable") === t ? "selected" : ""}>${t}</option>`).join("")}</select>
      <button class="btn primary">Guardar</button>
    </form>
  </section>`;
}

function clientesCobros() {
  const porCobrar = data.projects.filter((p) => !p.paid).reduce((a, p) => a + (p.amount || 0), 0);
  const clientName = (id) => data.clients.find((c) => c.id === id)?.name || "Sin cliente";
  const statusClass = (s) => (s === "activo" || s === "en curso" ? "ok" : s === "prospecto" || s === "por iniciar" ? "warn" : "");
  return `
    <section class="card">
      <h2>Clientes y cobros <small>${clp(porCobrar)} por cobrar</small></h2>
      ${list(data.projects, (p) => `
        <li class="item ${p.paid ? "done" : ""}">
          <div class="grow"><span class="t">${esc(p.name)}</span><span class="sub">${esc(clientName(p.clientId))} · ${clp(p.amount)}</span></div>
          <button class="chip ${statusClass(p.status)}" data-action="project-status" data-id="${p.id}">${esc(p.status)}</button>
          <button class="chip ${p.paid ? "ok" : "warn"}" data-action="toggle-paid" data-id="${p.id}">${p.paid ? "pagado" : "por cobrar"}</button>
          ${delBtn("projects", p.id)}
        </li>`, "Sin proyectos de clientes aún.")}
      <form class="inline" data-form="project">
        <input class="wide" name="name" placeholder="Proyecto (ej: Tienda Shopify)" required>
        <select name="clientId"><option value="">Sin cliente</option>${data.clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
        <input type="number" name="amount" min="0" step="1000" placeholder="Monto CLP">
        <button class="btn primary">+</button>
      </form>
      <p class="label mt">Clientes</p>
      ${list(data.clients, (c) => `
        <li class="item small">
          <div class="grow"><span>${esc(c.name)}</span>${c.contact ? `<span class="sub">${esc(c.contact)}</span>` : ""}</div>
          <button class="chip ${statusClass(c.status)}" data-action="client-status" data-id="${c.id}">${esc(c.status)}</button>
          ${delBtn("clients", c.id)}
        </li>`, "Agrega tu primer cliente.")}
      <form class="inline" data-form="client">
        <input class="wide" name="name" placeholder="Nombre del cliente" required>
        <input name="contact" placeholder="Contacto">
        <button class="btn primary">+</button>
      </form>
    </section>`;
}

/* ---------- Sub-vistas de Alimentación ---------- */
const comida = {
  dia() {
    const d = ui.day;
    const fbi = foodsById();
    const r = req();
    const plan = sumItems(itemsOf(d, "plan"), fbi);
    const real = sumItems(itemsOf(d, "real"), fbi);
    const main = new Set(["Desayuno", "Almuerzo", "Once", "Cena"]);
    return `
      <section class="card">
        <div class="week-nav">
          <button class="btn ghost small" data-action="day" data-d="-1">‹</button>
          <h2 class="cap" style="margin:0">${d === today() ? "Hoy, " : ""}${fmtDate(d, { weekday: "long", day: "numeric", month: "short" })}</h2>
          <button class="btn ghost small" data-action="day" data-d="1">›</button>
        </div>
        <div class="kcal-row">
          <div><span>Plan</span><b>${num(plan.kcal)}</b></div>
          <div><span>Real</span><b>${num(real.kcal)}</b></div>
          <div><span>Meta</span><b>${r ? num(r.kcal) : "–"}</b></div>
        </div>
        ${r ? bar(pct(real.kcal, r.kcal)) : `<p class="sub">Completa tu perfil en <a href="#" data-action="ctab" data-v="analisis">Análisis</a> para calcular tu meta.</p>`}
      </section>

      ${SLOTS.map((s) => {
        const p = itemsOf(d, "plan", s), rl = itemsOf(d, "real", s);
        if (!main.has(s) && !p.length && !rl.length) return "";
        const pk = sumItems(p, fbi).kcal, rk = sumItems(rl, fbi).kcal;
        return `<section class="card">
          <h2>${s} <small>plan ${num(pk)} · real ${num(rk)} kcal</small></h2>
          <div class="grid2">
            <div><p class="label">Planificado</p>${list(p, (i) => intakeItem(i, fbi), "—")}</div>
            <div><p class="label">Lo que comí</p>${list(rl, (i) => intakeItem(i, fbi), "—")}
              ${p.length && !rl.length ? `<button class="btn ghost small mt" data-action="copy-plan" data-v="${s}">✓ Comí lo planificado</button>` : ""}
            </div>
          </div>
        </section>`;
      }).join("")}

      <section class="card">
        <h2>Agregar alimento</h2>
        <form class="inline" data-form="intake">
          <select name="kind"><option value="real">Lo que comí</option><option value="plan">Planificado</option></select>
          <select name="slot">${SLOTS.map((s) => `<option>${s}</option>`).join("")}</select>
          <input class="wide" name="food" list="foods-list" placeholder="Alimento…" autocomplete="off" required>
          <input type="number" name="grams" min="1" step="1" placeholder="Gramos" inputmode="numeric" required>
          <button class="btn primary">+</button>
        </form>
        <datalist id="foods-list">${data.foods.map((f) => `<option value="${esc(f.nombre)}">`).join("")}</datalist>
        ${data.foods.length ? "" : `<p class="sub mt">Primero carga alimentos en la pestaña <a href="#" data-action="ctab" data-v="alimentos">Alimentos</a>.</p>`}
      </section>`;
  },

  semana() {
    const days = weekDays(ui.weekOffset);
    const t = today();
    const fbi = foodsById();
    return `
      <section class="card">
        <div class="week-nav">
          <button class="btn ghost small" data-action="week" data-d="-1">‹</button>
          <h2 style="margin:0">Semana del ${fmtDate(days[0], { day: "numeric", month: "short" })}</h2>
          <button class="btn ghost small" data-action="week" data-d="1">›</button>
        </div>
        ${days.map((d) => {
          const p = itemsOf(d, "plan"), rl = itemsOf(d, "real");
          return `<div class="day ${d === t ? "today" : ""}">
            <h3><a href="#" data-action="open-day" data-v="${d}">${fmtDate(d, { weekday: "long", day: "numeric" })}</a>
              <small>plan ${num(sumItems(p, fbi).kcal)} · real ${num(sumItems(rl, fbi).kcal)} kcal</small></h3>
            ${SLOTS.map((s) => {
              const xs = p.filter((i) => i.slot === s);
              return xs.length ? `<div class="meal"><b>${s}</b><span>${esc(xs.map((i) => `${i.nombre} ${num(i.grams)} g`).join(", "))}</span></div>` : "";
            }).join("") || `<p class="empty">Sin plan</p>`}
          </div>`;
        }).join("")}
      </section>

      <section class="card">
        <h2>Plan desde Claude</h2>
        <p class="sub">1) Copia las instrucciones y pégalas en Claude. 2) Pega aquí el JSON que te responda.</p>
        <button class="btn ghost small mt" data-action="copy-prompt">Copiar instrucciones para esta semana</button>
        <form data-form="import" class="stack mt">
          <textarea name="json" rows="5" placeholder='{"alimentos": [...], "plan": [...]}' required></textarea>
          <label class="check"><input type="checkbox" name="replace" checked> Reemplazar el plan existente en esas fechas</label>
          <button class="btn primary">Importar plan</button>
        </form>
      </section>`;
  },

  analisis() {
    const fbi = foodsById();
    const r = req();
    const days = ui.rango === "dia" ? [ui.day] : weekDays(ui.weekOffset);
    const plan = totalsForDays(days, "plan");
    const real = totalsForDays(days, "real");
    const p = profile();
    const ms = macroSplit(real.avg);
    const stCls = (s) => (s === "ok" ? "st-ok" : s === "bajo" ? "st-bajo" : s === "alto" ? "st-alto" : "");
    const rangoTxt = ui.rango === "dia" ? fmtDate(ui.day, { weekday: "long", day: "numeric", month: "short" })
      : `semana del ${fmtDate(days[0], { day: "numeric", month: "short" })} (promedio de ${real.days} día${real.days === 1 ? "" : "s"} con registro)`;

    return `
      <section class="card">
        ${miniTabs("rango", ui.rango, [["dia", "Día"], ["semana", "Semana"]])}
        <p class="sub cap">${rangoTxt}</p>
        <div class="table-wrap"><table class="nutri">
          <thead><tr><th>Nutriente</th><th>Meta</th><th>Plan</th><th>Real</th><th>% meta</th><th>Real − plan</th></tr></thead>
          <tbody>${NUTRIENTS.map((n) => {
            const rv = r?.[n.key];
            const a = adequacy(real.avg[n.key], rv, n.max);
            const diff = real.avg[n.key] - plan.avg[n.key];
            return `<tr>
              <td>${n.label} <small>${n.unit}</small></td>
              <td>${rv ? (n.max ? "≤ " : "") + num(rv, n.dec) : "–"}</td>
              <td>${num(plan.avg[n.key], n.dec)}</td>
              <td><b>${num(real.avg[n.key], n.dec)}</b></td>
              <td class="${stCls(a.state)}">${a.pct != null ? a.pct + "%" : "–"}</td>
              <td class="${diff > 0 ? "pos" : diff < 0 ? "neg" : ""}">${diff > 0 ? "+" : ""}${num(diff, n.dec)}</td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>
        <p class="sub mt">Distribución real: proteínas ${ms.prot}% · carbohidratos ${ms.cho}% · lípidos ${ms.lip}%
          (meta ${p.pctProt}/${p.pctCho}/${p.pctLip})</p>
        <p class="sub"><span class="st-ok">■</span> 90–110% <span class="st-bajo">■</span> bajo <span class="st-alto">■</span> alto · el sodio se evalúa como máximo</p>
      </section>

      <section class="card">
        <h2>Mis requerimientos</h2>
        <form data-form="perfil" class="grid-form">
          <label>Sexo<select name="sexo"><option value="F" ${p.sexo === "F" ? "selected" : ""}>Mujer</option><option value="M" ${p.sexo === "M" ? "selected" : ""}>Hombre</option></select></label>
          <label>Edad<input type="number" name="edad" min="10" max="100" value="${esc(p.edad)}"></label>
          <label>Peso (kg)<input type="number" name="peso" min="20" step="0.1" value="${esc(p.peso)}"></label>
          <label>Talla (cm)<input type="number" name="talla" min="100" step="0.1" value="${esc(p.talla)}"></label>
          <label>Factor actividad<input type="number" name="fa" min="1" max="2.5" step="0.05" value="${esc(p.fa)}"></label>
          <label>kcal manual (opcional)<input type="number" name="kcalManual" min="800" value="${esc(p.kcalManual)}"></label>
          <label>% proteínas<input type="number" name="pctProt" min="5" max="50" value="${esc(p.pctProt)}"></label>
          <label>% carbohidratos<input type="number" name="pctCho" min="5" max="80" value="${esc(p.pctCho)}"></label>
          <label>% lípidos<input type="number" name="pctLip" min="5" max="70" value="${esc(p.pctLip)}"></label>
          <label>Fibra (g)<input type="number" name="fibra" min="0" value="${esc(p.fibra)}"></label>
          <label>Sodio máx (mg)<input type="number" name="sodio" min="0" value="${esc(p.sodio)}"></label>
          <label>Calcio (mg)<input type="number" name="calcio" min="0" value="${esc(p.calcio)}"></label>
          <label>Hierro (mg)<input type="number" name="hierro" min="0" step="0.1" value="${esc(p.hierro)}"></label>
          <button class="btn primary">Guardar</button>
        </form>
        ${r ? `<p class="sub mt">${r.tmb ? `Mifflin-St Jeor: GEB ${num(r.tmb)} kcal × FA ${p.fa} = ` : "Meta manual: "}<b>${num(r.kcal)} kcal</b> ·
          P ${num(r.prot)} g · CHO ${num(r.cho)} g · L ${num(r.lip)} g</p>` : ""}
        ${Number(p.pctProt) + Number(p.pctCho) + Number(p.pctLip) !== 100 ? `<p class="sub st-alto">Los porcentajes de macronutrientes suman ${Number(p.pctProt) + Number(p.pctCho) + Number(p.pctLip)}%.</p>` : ""}
      </section>`;
  },

  alimentos() {
    const foods = [...data.foods].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    return `
      ${data.foods.length ? "" : `<section class="card soft"><h2>Empieza con una base</h2>
        <p class="sub">${SEED_FOODS.length} alimentos comunes con valores referenciales por 100 g (USDA). Puedes editarlos o agregar los tuyos desde tu tabla de composición.</p>
        <button class="btn primary mt" data-action="seed-foods">Cargar alimentos base</button></section>`}
      <section class="card">
        <h2>Alimentos <small>${foods.length} · valores por 100 g</small></h2>
        <input type="search" data-filter="foods" placeholder="Buscar…">
        <ul class="list mt" id="foods-ul">${foods.map((f) => `
          <li class="item small" data-name="${esc(normalize(f.nombre))}">
            <div class="grow">${esc(f.nombre)}<span class="sub">${num(f.kcal)} kcal · P ${num(f.prot, 1)} · CHO ${num(f.cho, 1)} · L ${num(f.lip, 1)} · fibra ${num(f.fibra, 1)} · Na ${num(f.sodio)} mg</span></div>
            ${delBtn("foods", f.id)}
          </li>`).join("")}</ul>
      </section>
      <section class="card">
        <h2>Nuevo alimento <small>por 100 g</small></h2>
        <form data-form="food" class="grid-form">
          <label class="span2">Nombre<input name="nombre" required></label>
          ${NUTRIENTS.map((n) => `<label>${n.label} (${n.unit})<input type="number" name="${n.key}" min="0" step="0.1" required></label>`).join("")}
          <button class="btn primary">Agregar</button>
        </form>
      </section>`;
  },

  compras() {
    const shopping = [...data.shopping].sort((a, b) => Number(a.done) - Number(b.done));
    const planWeek = weekDays(ui.weekOffset);
    return `
      <section class="card">
        <h2>Lista de compras ${data.shopping.some((s) => s.done) ? `<small><a href="#" data-action="clear-shop">Limpiar comprados</a></small>` : ""}</h2>
        ${list(shopping, (s) => `
          <li class="item ${s.done ? "done" : ""}">
            <label><input type="checkbox" data-action="toggle-shop" data-id="${s.id}" ${s.done ? "checked" : ""}><span class="t">${esc(s.item)}</span></label>
            ${delBtn("shopping", s.id)}
          </li>`, "Lista vacía.")}
        <form class="inline" data-form="shop">
          <input class="wide" name="item" placeholder="Agregar producto…" required>
          <button class="btn primary">+</button>
        </form>
        <button class="btn ghost small mt" data-action="shop-from-plan">Agregar lo del plan de la semana del ${fmtDate(planWeek[0], { day: "numeric", month: "short" })}</button>
      </section>`;
  },
};

/* =========================================================
   Render
   ========================================================= */
function isTyping() {
  const a = document.activeElement;
  return a && $("#view").contains(a) && ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName) && a.type !== "checkbox";
}

function render() {
  if (!uid) return;
  if (isTyping()) { pendingRender = true; return; } // no borrar lo que estás escribiendo
  pendingRender = false;
  $("#view-title").textContent = TITLES[ui.view];
  $("#view").innerHTML = views[ui.view]();
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.view === ui.view));
}

$("#view").addEventListener("focusout", () => setTimeout(() => { if (pendingRender && !isTyping()) render(); }, 0));

function go(view) {
  ui.view = view;
  document.activeElement?.blur();
  render();
  window.scrollTo(0, 0);
  if (view === "hoy" || view === "coramba") loadCoramba();
  if (view === "casa") loadGastos(ui.mes);
}
document.querySelector(".tabbar").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-view]");
  if (b) go(b.dataset.view);
});

/* =========================================================
   Acciones
   ========================================================= */
async function seedFoods() {
  const batch = writeBatch(db);
  SEED_FOODS.forEach((f) => batch.set(doc(col("foods")), { ...f, createdAt: serverTimestamp() }));
  await batch.commit();
}

async function importPlan(f) {
  const { newFoods, items, warnings } = parsePlan(f.json, data.foods);
  if (!items.length) throw new Error("El plan no trae alimentos.");
  if (items.length + newFoods.length > 450) throw new Error("El plan es muy grande; impórtalo por partes.");
  const batch = writeBatch(db);
  if (f.replace) {
    const dates = new Set(items.map((i) => i.date));
    data.intake.filter((i) => i.kind === "plan" && dates.has(i.date)).forEach((i) => batch.delete(ref("intake", i.id)));
  }
  for (const nf of newFoods) {
    const r = doc(col("foods"));
    batch.set(r, { ...nf, createdAt: serverTimestamp() });
    nf.id = r.id; // para enlazar los ítems del plan con el alimento nuevo
  }
  for (const it of items) {
    batch.set(doc(col("intake")), {
      date: it.date, slot: it.slot, kind: "plan", nombre: it.nombre, grams: it.grams,
      foodId: it.food?.id || null, createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
  alert(`Plan importado: ${items.length} ítems${newFoods.length ? `, ${newFoods.length} alimentos nuevos` : ""}.` +
    (warnings.length ? `\n\nRevisa:\n• ${[...new Set(warnings)].slice(0, 8).join("\n• ")}` : ""));
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); alert("Copiado. Pégalo en Claude."); }
  catch { window.prompt("Copia este texto:", text); }
}

const actions = {
  nav: (el) => go(el.dataset.view),
  "goto-comida": (el) => { ui.comidaTab = el.dataset.v; ui.day = today(); go("comida"); },
  del: (el) => { if (confirm("¿Eliminar?")) del(el.dataset.col, el.dataset.id); },
  "toggle-task": (el) => upd("tasks", el.dataset.id, { done: el.checked, doneAt: el.checked ? today() : null }),
  "toggle-shop": (el) => upd("shopping", el.dataset.id, { done: el.checked }),
  "clear-shop": () => data.shopping.filter((s) => s.done).forEach((s) => del("shopping", s.id)),
  "toggle-paid": (el) => { const p = data.projects.find((x) => x.id === el.dataset.id); upd("projects", p.id, { paid: !p.paid }); },
  "project-status": (el) => { const p = data.projects.find((x) => x.id === el.dataset.id); upd("projects", p.id, { status: next(PROJECT_STATUS, p.status) }); },
  "client-status": (el) => { const c = data.clients.find((x) => x.id === el.dataset.id); upd("clients", c.id, { status: next(CLIENT_STATUS, c.status) }); },
  filter: (el) => { ui.taskFilter = el.dataset.v; render(); },

  // Estudio
  "add-template": (el) => { const { ...t } = STUDY_TEMPLATES[el.dataset.v]; add("goals", t); },
  vocab: (el) => {
    const g = data.goals.find((x) => x.id === el.dataset.id);
    const v = Math.max(0, Math.min(g.vocabTarget, (g.vocabLearned || 0) + Number(el.dataset.d)));
    upd("goals", g.id, { vocabLearned: v });
  },
  course: (el) => {
    const g = data.goals.find((x) => x.id === el.dataset.id);
    const courses = g.courses.map((c, i) => (i === Number(el.dataset.i) ? { ...c, done: el.checked } : c));
    upd("goals", g.id, { courses });
  },

  // Alimentación
  ctab: (el) => { ui.comidaTab = el.dataset.v; render(); window.scrollTo(0, 0); },
  day: (el) => { ui.day = shiftDay(ui.day, Number(el.dataset.d)); render(); },
  "open-day": (el) => { ui.day = el.dataset.v; ui.comidaTab = "dia"; render(); window.scrollTo(0, 0); },
  week: (el) => { ui.weekOffset += Number(el.dataset.d); render(); },
  rango: (el) => { ui.rango = el.dataset.v; render(); },
  "seed-foods": () => seedFoods(),
  "copy-plan": async (el) => {
    const batch = writeBatch(db);
    itemsOf(ui.day, "plan", el.dataset.v).forEach((i) => batch.set(doc(col("intake")), {
      date: i.date, slot: i.slot, kind: "real", nombre: i.nombre, grams: i.grams, foodId: i.foodId || null, createdAt: serverTimestamp(),
    }));
    await batch.commit();
  },
  "copy-prompt": () => {
    const days = weekDays(ui.weekOffset);
    copyText(claudePrompt({ desde: days[0], hasta: days[6], foods: data.foods, req: req() }));
  },
  "shop-from-plan": async () => {
    const days = new Set(weekDays(ui.weekOffset));
    const names = [...new Set(data.intake.filter((i) => i.kind === "plan" && days.has(i.date)).map((i) => i.nombre))];
    const have = new Set(data.shopping.filter((s) => !s.done).map((s) => normalize(s.item)));
    const nuevos = names.filter((n) => !have.has(normalize(n)));
    if (!nuevos.length) return alert("No hay alimentos nuevos que agregar del plan.");
    const batch = writeBatch(db);
    nuevos.forEach((item) => batch.set(doc(col("shopping")), { item, done: false, createdAt: serverTimestamp() }));
    await batch.commit();
  },

  // Coramba (Notion)
  "notion-refresh": () => loadCoramba(true),
  "notion-estado": async (el) => {
    const dbKey = el.dataset.db;
    const item = nt.coramba[dbKey].find((x) => x.id === el.dataset.id);
    const prev = item.estado;
    item.estado = next(NOTION_ESTADOS[dbKey], prev);
    render();
    try { await api("estado", { body: { db: dbKey, pageId: item.id, estado: item.estado } }); }
    catch (e) { item.estado = prev; render(); alert("No se pudo actualizar en Notion: " + e.message); }
  },

  // Casa (Notion)
  mes: (el) => { ui.mes = shiftMonth(ui.mes, Number(el.dataset.d)); render(); loadGastos(ui.mes); },
  "gastos-refresh": () => loadGastos(ui.mes, true),
  "gasto-cat": (el) => {
    ui.gastoCat = el.dataset.v; render();
    const card = $("#gasto-card");
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.querySelector('[name="monto"]')?.focus();
  },
  "gasto-del": async (el) => {
    if (!confirm("¿Eliminar este gasto de Notion?")) return;
    try { await api("borrarGasto", { body: { pageId: el.dataset.id } }); await loadGastos(ui.mes, true); }
    catch (e) { alert("No se pudo eliminar: " + e.message); }
  },
};

$("#view").addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.type === "checkbox") return;
  e.preventDefault();
  Promise.resolve(actions[el.dataset.action]?.(el)).catch((err) => alert(err.message));
});
$("#view").addEventListener("change", (e) => {
  const el = e.target;
  if (el.type === "checkbox" && el.dataset.action) Promise.resolve(actions[el.dataset.action]?.(el)).catch((err) => alert(err.message));
});
// Filtro de alimentos sin re-render (para no perder el foco)
$("#view").addEventListener("input", (e) => {
  if (e.target.dataset.filter !== "foods") return;
  const q = normalize(e.target.value);
  document.querySelectorAll("#foods-ul li").forEach((li) => { li.hidden = q && !li.dataset.name.includes(q); });
});

const forms = {
  task: (f, form) => add("tasks", { title: f.title.trim(), due: f.due || null, area: f.area || form.dataset.area, done: false }),
  goal: (f) => add("goals", { title: f.title.trim(), kind: "horas", targetHours: Number(f.targetHours), deadline: f.deadline || null }),
  deadline: (f, form) => upd("goals", form.dataset.id, { deadline: f.deadline || null }),
  session: (f) => add("sessions", { goalId: f.goalId, minutes: Number(f.minutes), date: f.date }),
  shop: (f) => add("shopping", { item: f.item.trim(), done: false }),
  client: (f) => add("clients", { name: f.name.trim(), contact: f.contact.trim(), status: "activo" }),
  project: (f) => add("projects", { name: f.name.trim(), clientId: f.clientId || null, amount: Number(f.amount) || 0, paid: false, status: "en curso" }),
  intake: (f) => {
    const food = data.foods.find((x) => normalize(x.nombre) === normalize(f.food));
    if (!food) throw new Error(`"${f.food}" no está en tus alimentos. Agrégalo en la pestaña Alimentos.`);
    return add("intake", { date: ui.day, slot: f.slot, kind: f.kind, foodId: food.id, nombre: food.nombre, grams: Number(f.grams) });
  },
  food: (f) => add("foods", { nombre: f.nombre.trim(), ...Object.fromEntries(KEYS.map((k) => [k, Number(f[k]) || 0])) }),
  perfil: (f) => setDoc(ref("settings", "nutri"), {
    ...f,
    ...Object.fromEntries(["edad", "peso", "talla", "fa", "pctProt", "pctCho", "pctLip", "fibra", "sodio", "calcio", "hierro"].map((k) => [k, f[k] === "" ? "" : Number(f[k])])),
    kcalManual: f.kcalManual === "" ? "" : Number(f.kcalManual),
  }),
  import: (f) => importPlan({ json: f.json, replace: f.replace === "on" }),
  gasto: async (f) => {
    await api("nuevoGasto", { body: { ...f, monto: Number(f.monto) } });
    ui.gastoCat = "";
    const mes = f.fecha.slice(0, 7);
    delete nt.gastos[mes];
    await loadGastos(ui.mes, true);
  },
};

$("#view").addEventListener("submit", async (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  const btn = form.querySelector("button");
  document.activeElement?.blur();
  if (btn) btn.disabled = true;
  try {
    await forms[form.dataset.form](f, form);
    form.reset();
  } catch (err) { alert(err.message); }
  finally { if (btn) btn.disabled = false; render(); }
});
