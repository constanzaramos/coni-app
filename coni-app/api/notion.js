// Función serverless (Vercel) que conecta la app con Notion.
// El token de Notion nunca llega al navegador: vive en las variables de entorno.
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const NOTION_VERSION = "2025-09-03";

// IDs de las fuentes de datos (data sources) en tu Notion.
const DS = {
  puesta: process.env.NOTION_DS_PUESTA || "fb01e488-b592-48d0-b5ba-234e2182eb6a",   // Coramba OS › Tareas de puesta en marcha
  shopify: process.env.NOTION_DS_SHOPIFY || "ee452c4a-6cec-4271-8d68-a971d73841fd", // Coramba OS › Tareas de desarrollo Shopify
  agenda: process.env.NOTION_DS_AGENDA || "36f9db65-78a7-48ef-bb37-56a2ed3170ed",   // Coramba OS › Agenda Coramba
  gastos: process.env.NOTION_DS_GASTOS || "41af048f-3f81-8186-9b72-000b645d71af",   // Nuestro Hogar › Gastos del hogar
};

const ESTADOS = {
  puesta: ["Pendiente", "En curso", "Hecho"],
  shopify: ["Por hacer", "En curso", "En revisión", "Hecho"],
};
const CATEGORIAS = [
  "Gastos comunes", "Luz", "Agua", "Gas", "Internet y streaming", "Supermercado y feria",
  "Aseo y hogar", "Mantención y reparaciones", "Muebles y equipamiento", "Salidas juntos", "Mascota", "Imprevistos",
];
const PAGADO_POR = ["Cuenta del hogar", "Coni", "David"];
const REPARTO = ["Proporcional", "50/50", "Solo Coni", "Solo David"];
const TIPO = ["Fijo", "Variable"];

if (!getApps().length) initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
const ALLOWED = (process.env.ALLOWED_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function notion(path, method = "GET", body) {
  const r = await fetch("https://api.notion.com/v1" + path, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, `Notion: ${j.message || r.statusText}`);
  return j;
}

async function queryAll(ds, body = {}) {
  const out = [];
  let cursor;
  do {
    const j = await notion(`/data_sources/${ds}/query`, "POST", { ...body, start_cursor: cursor, page_size: 100 });
    out.push(...j.results);
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return out;
}

// Convierte una propiedad de Notion a un valor simple
function val(p) {
  if (!p) return null;
  switch (p.type) {
    case "title": return p.title.map((t) => t.plain_text).join("");
    case "rich_text": return p.rich_text.map((t) => t.plain_text).join("");
    case "select": return p.select?.name ?? null;
    case "status": return p.status?.name ?? null;
    case "date": return p.date?.start ?? null;
    case "number": return p.number;
    case "checkbox": return p.checkbox;
    case "formula": return p.formula?.[p.formula.type] ?? null;
    default: return null;
  }
}
const row = (page, map) => ({
  id: page.id,
  url: page.url,
  ...Object.fromEntries(Object.entries(map).map(([k, name]) => [k, val(page.properties[name])])),
});

async function verify(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) throw new HttpError(401, "Falta iniciar sesión");
  let user;
  try { user = await getAuth().verifyIdToken(token); }
  catch { throw new HttpError(401, "Sesión inválida"); }
  if (ALLOWED.length && !ALLOWED.includes((user.email || "").toLowerCase())) throw new HttpError(403, "Cuenta no autorizada");
  return user;
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const isMonth = (s) => /^\d{4}-\d{2}$/.test(s || "");
const oneOf = (v, list, name) => { if (!list.includes(v)) throw new HttpError(400, `${name}: valor no válido`); return v; };

const actions = {
  // Resumen de Coramba: puesta en marcha, sitio Shopify y agenda
  async coramba() {
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
    const [puesta, shopify, agenda] = await Promise.all([
      queryAll(DS.puesta),
      queryAll(DS.shopify, { sorts: [{ property: "Orden", direction: "ascending" }] }),
      queryAll(DS.agenda, {
        filter: { property: "Fecha", date: { on_or_after: hoy } },
        sorts: [{ property: "Fecha", direction: "ascending" }],
      }),
    ]);
    return {
      puesta: puesta.map((p) => row(p, { tarea: "Tarea", estado: "Estado", area: "Área", fecha: "Fecha", urgente: "Urgente" })),
      shopify: shopify.map((p) => row(p, {
        tarea: "Tarea", estado: "Estado", fase: "Fase", prioridad: "Prioridad", orden: "Orden",
        horasEst: "Horas estimadas", horasReal: "Horas reales",
      })),
      agenda: agenda.map((p) => row(p, { evento: "Evento", fecha: "Fecha", tipo: "Tipo", notas: "Notas" })),
      at: new Date().toISOString(),
    };
  },

  async estado(req) {
    const { db, pageId, estado } = req.body || {};
    if (!ESTADOS[db]) throw new HttpError(400, "Base inválida");
    oneOf(estado, ESTADOS[db], "Estado");
    if (!/^[0-9a-f-]{32,36}$/i.test(pageId || "")) throw new HttpError(400, "Página inválida");
    // Verifica que la página pertenece a esa base antes de modificarla
    const page = await notion(`/pages/${pageId}`);
    if (page.parent?.data_source_id?.replace(/-/g, "") !== DS[db].replace(/-/g, "")) throw new HttpError(403, "Página fuera de la base");
    await notion(`/pages/${pageId}`, "PATCH", { properties: { Estado: { status: { name: estado } } } });
    return { ok: true };
  },

  // Gastos del hogar de un mes (AAAA-MM)
  async gastos(req) {
    const mes = req.query.mes;
    if (!isMonth(mes)) throw new HttpError(400, "Mes inválido");
    const [y, m] = mes.split("-").map(Number);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const pages = await queryAll(DS.gastos, {
      filter: { and: [
        { property: "Fecha", date: { on_or_after: `${mes}-01` } },
        { property: "Fecha", date: { before: next } },
      ] },
      sorts: [{ property: "Fecha", direction: "descending" }],
    });
    return {
      gastos: pages.map((p) => row(p, {
        concepto: "Concepto", monto: "Monto", categoria: "Categoría", fecha: "Fecha", pagadoPor: "Pagado por",
        reparto: "Reparto", tipo: "Tipo", notas: "Notas",
        aporteConi: "Aporte Coni", aporteDavid: "Aporte David", balanceConi: "Balance Coni",
      })),
    };
  },

  async nuevoGasto(req) {
    const b = req.body || {};
    const monto = Number(b.monto);
    if (!b.concepto?.trim()) throw new HttpError(400, "Falta el concepto");
    if (!(monto > 0)) throw new HttpError(400, "Monto inválido");
    if (!isDate(b.fecha)) throw new HttpError(400, "Fecha inválida");
    const props = {
      Concepto: { title: [{ text: { content: b.concepto.trim().slice(0, 200) } }] },
      Monto: { number: Math.round(monto) },
      Fecha: { date: { start: b.fecha } },
      Categoría: { select: { name: oneOf(b.categoria, CATEGORIAS, "Categoría") } },
      "Pagado por": { select: { name: oneOf(b.pagadoPor, PAGADO_POR, "Pagado por") } },
      Reparto: { select: { name: oneOf(b.reparto, REPARTO, "Reparto") } },
      Tipo: { select: { name: oneOf(b.tipo, TIPO, "Tipo") } },
    };
    if (b.notas?.trim()) props.Notas = { rich_text: [{ text: { content: b.notas.trim().slice(0, 500) } }] };
    const page = await notion("/pages", "POST", { parent: { type: "data_source_id", data_source_id: DS.gastos }, properties: props });
    return { id: page.id };
  },

  async borrarGasto(req) {
    const { pageId } = req.body || {};
    if (!/^[0-9a-f-]{32,36}$/i.test(pageId || "")) throw new HttpError(400, "Página inválida");
    const page = await notion(`/pages/${pageId}`);
    if (page.parent?.data_source_id?.replace(/-/g, "") !== DS.gastos.replace(/-/g, "")) throw new HttpError(403, "Página fuera de la base");
    await notion(`/pages/${pageId}`, "PATCH", { in_trash: true });
    return { ok: true };
  },
};

const WRITE_ACTIONS = new Set(["estado", "nuevoGasto", "borrarGasto"]);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const action = req.query.action;
    if (!actions[action]) throw new HttpError(404, "Acción desconocida");
    if (WRITE_ACTIONS.has(action) && req.method !== "POST") throw new HttpError(405, "Usa POST");
    if (!process.env.NOTION_TOKEN) throw new HttpError(500, "Falta configurar NOTION_TOKEN");
    await verify(req);
    res.status(200).json(await actions[action](req));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || "Error" });
  }
}
