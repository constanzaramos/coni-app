// Cálculos nutricionales — funciones puras, sin dependencias.

export const NUTRIENTS = [
  { key: "kcal",   label: "Energía",       unit: "kcal", dec: 0 },
  { key: "prot",   label: "Proteínas",     unit: "g",    dec: 1 },
  { key: "cho",    label: "Carbohidratos", unit: "g",    dec: 1 },
  { key: "lip",    label: "Lípidos",       unit: "g",    dec: 1 },
  { key: "fibra",  label: "Fibra",         unit: "g",    dec: 1 },
  { key: "sodio",  label: "Sodio",         unit: "mg",   dec: 0, max: true }, // límite máximo
  { key: "calcio", label: "Calcio",        unit: "mg",   dec: 0 },
  { key: "hierro", label: "Hierro",        unit: "mg",   dec: 1 },
];
export const KEYS = NUTRIENTS.map((n) => n.key);
export const SLOTS = ["Desayuno", "Colación AM", "Almuerzo", "Once", "Cena", "Colación PM"];

// Valores referenciales por 100 g (base USDA FoodData Central / SR Legacy).
// Revísalos o reemplázalos con la Tabla de Composición de Alimentos que uses.
// [nombre, kcal, prot, cho, lip, fibra, sodio, calcio, hierro]
export const SEED_FOODS = [
  ["Pan blanco (marraqueta)", 266, 7.6, 50.6, 3.3, 2.4, 490, 151, 3.7],
  ["Pan integral", 252, 12.4, 42.7, 3.5, 6.0, 455, 161, 2.5],
  ["Arroz blanco cocido", 130, 2.7, 28.2, 0.3, 0.4, 1, 10, 0.2],
  ["Fideos cocidos", 158, 5.8, 30.9, 0.9, 1.8, 1, 7, 0.5],
  ["Avena en hojuelas", 379, 13.2, 67.7, 6.5, 10.1, 6, 52, 4.3],
  ["Papa cocida", 87, 1.9, 20.1, 0.1, 1.8, 4, 5, 0.3],
  ["Quínoa cocida", 120, 4.4, 21.3, 1.9, 2.8, 7, 17, 1.5],
  ["Lentejas cocidas", 116, 9.0, 20.1, 0.4, 7.9, 2, 19, 3.3],
  ["Porotos negros cocidos", 132, 8.9, 23.7, 0.5, 8.7, 1, 27, 2.1],
  ["Garbanzos cocidos", 164, 8.9, 27.4, 2.6, 7.6, 7, 49, 2.9],
  ["Pechuga de pollo cocida", 165, 31.0, 0, 3.6, 0, 74, 15, 1.0],
  ["Posta de vacuno cocida", 191, 29.5, 0, 7.2, 0, 60, 6, 2.9],
  ["Huevo entero", 143, 12.6, 0.7, 9.5, 0, 142, 56, 1.8],
  ["Atún en agua", 116, 25.5, 0, 0.8, 0, 338, 11, 1.5],
  ["Salmón cocido", 206, 22.1, 0, 12.4, 0, 61, 15, 0.3],
  ["Leche semidescremada", 46, 3.2, 4.8, 1.5, 0, 45, 120, 0],
  ["Yogur natural descremado", 56, 5.7, 7.7, 0.2, 0, 77, 199, 0.1],
  ["Queso gauda", 356, 24.9, 2.2, 27.4, 0, 819, 700, 0.2],
  ["Palta", 160, 2.0, 8.5, 14.7, 6.7, 7, 12, 0.6],
  ["Aceite de oliva", 884, 0, 0, 100, 0, 2, 1, 0.6],
  ["Manzana", 52, 0.3, 13.8, 0.2, 2.4, 1, 6, 0.1],
  ["Plátano", 89, 1.1, 22.8, 0.3, 2.6, 1, 5, 0.3],
  ["Naranja", 47, 0.9, 11.8, 0.1, 2.4, 0, 40, 0.1],
  ["Frutillas", 32, 0.7, 7.7, 0.3, 2.0, 1, 16, 0.4],
  ["Tomate", 18, 0.9, 3.9, 0.2, 1.2, 5, 10, 0.3],
  ["Lechuga", 15, 1.4, 2.9, 0.2, 1.3, 28, 36, 0.9],
  ["Zanahoria cruda", 41, 0.9, 9.6, 0.2, 2.8, 69, 33, 0.3],
  ["Brócoli cocido", 35, 2.4, 7.2, 0.4, 3.3, 41, 40, 0.7],
  ["Espinaca cruda", 23, 2.9, 3.6, 0.4, 2.2, 79, 99, 2.7],
  ["Almendras", 579, 21.2, 21.6, 49.9, 12.5, 1, 269, 3.7],
  ["Nueces", 654, 15.2, 13.7, 65.2, 6.7, 2, 98, 2.9],
  ["Mantequilla de maní", 588, 25.1, 19.6, 50.4, 6.0, 426, 43, 1.7],
  ["Azúcar", 387, 0, 100, 0, 0, 1, 1, 0],
].map(([nombre, ...vals]) => ({ nombre, ...Object.fromEntries(KEYS.map((k, i) => [k, vals[i]])) }));

export const DEFAULT_PROFILE = {
  sexo: "F", edad: "", peso: "", talla: "", fa: 1.5,
  pctProt: 20, pctCho: 50, pctLip: 30, kcalManual: "",
  fibra: 25, sodio: 2000, calcio: 1000, hierro: 18,
};

export const normalize = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const zero = () => Object.fromEntries(KEYS.map((k) => [k, 0]));

/** Mifflin-St Jeor × factor de actividad, o kcal manual si está definido. */
export function requirements(p) {
  if (!p) return null;
  const num = (v) => (v === "" || v == null ? NaN : Number(v));
  let tmb = null;
  if (num(p.peso) > 0 && num(p.talla) > 0 && num(p.edad) > 0) {
    tmb = 10 * num(p.peso) + 6.25 * num(p.talla) - 5 * num(p.edad) + (p.sexo === "M" ? 5 : -161);
  }
  const kcal = num(p.kcalManual) > 0 ? num(p.kcalManual) : tmb ? tmb * (num(p.fa) || 1.5) : null;
  if (!kcal) return null;
  return {
    tmb: tmb ? Math.round(tmb) : null,
    kcal: Math.round(kcal),
    prot: (kcal * num(p.pctProt)) / 100 / 4,
    cho: (kcal * num(p.pctCho)) / 100 / 4,
    lip: (kcal * num(p.pctLip)) / 100 / 9,
    fibra: num(p.fibra),
    sodio: num(p.sodio),
    calcio: num(p.calcio),
    hierro: num(p.hierro),
  };
}

/** Nutrientes de un ítem {foodId, grams, per100?} */
export function itemNutrients(item, foodsById) {
  const f = foodsById[item.foodId] || item.per100;
  const out = zero();
  if (!f) return out;
  const factor = (Number(item.grams) || 0) / 100;
  for (const k of KEYS) out[k] = (Number(f[k]) || 0) * factor;
  return out;
}

export function sumItems(items, foodsById) {
  const t = zero();
  for (const it of items) {
    const n = itemNutrients(it, foodsById);
    for (const k of KEYS) t[k] += n[k];
  }
  return t;
}

/** % del requerimiento y estado (ok | bajo | alto) */
export function adequacy(value, req, isMax = false) {
  if (!req) return { pct: null, state: "" };
  const pct = Math.round((value / req) * 100);
  if (isMax) return { pct, state: pct > 100 ? "alto" : "ok" };
  return { pct, state: pct < 90 ? "bajo" : pct > 110 ? "alto" : "ok" };
}

/** Distribución % de la energía por macronutriente */
export function macroSplit(t) {
  const kcal = t.prot * 4 + t.cho * 4 + t.lip * 9;
  if (!kcal) return { prot: 0, cho: 0, lip: 0 };
  return {
    prot: Math.round((t.prot * 4 * 100) / kcal),
    cho: Math.round((t.cho * 4 * 100) / kcal),
    lip: Math.round((t.lip * 9 * 100) / kcal),
  };
}

/**
 * Lee el JSON de un plan generado por Claude.
 * Formato: { alimentos:[{nombre,kcal,...}], plan:[{fecha,tiempo,items:[{alimento,gramos}]}] }
 * Devuelve qué alimentos crear y qué ítems de plan registrar.
 */
export function parsePlan(text, foods) {
  let json;
  try {
    const clean = String(text).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    json = JSON.parse(clean);
  } catch {
    throw new Error("El texto no es un JSON válido. Copia solo el bloque JSON que entregó Claude.");
  }
  if (!Array.isArray(json.plan)) throw new Error('Falta la lista "plan".');

  const byName = new Map(foods.map((f) => [normalize(f.nombre), f]));
  const newFoods = [];
  for (const a of json.alimentos || []) {
    if (!a?.nombre || byName.has(normalize(a.nombre))) continue;
    const f = { nombre: String(a.nombre).trim(), ...Object.fromEntries(KEYS.map((k) => [k, Number(a[k]) || 0])) };
    newFoods.push(f);
    byName.set(normalize(f.nombre), f);
  }

  const slotByName = new Map(SLOTS.map((s) => [normalize(s), s]));
  const aliases = { colacion: "Colación AM", "colacion am": "Colación AM", "colacion pm": "Colación PM", merienda: "Once", desayuno: "Desayuno" };
  const items = [];
  const warnings = [];
  for (const m of json.plan) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m?.fecha || "")) { warnings.push(`Fecha inválida: ${m?.fecha}`); continue; }
    const slot = slotByName.get(normalize(m.tiempo)) || aliases[normalize(m.tiempo)];
    if (!slot) { warnings.push(`Tiempo de comida desconocido: ${m.tiempo}`); continue; }
    for (const it of m.items || []) {
      const food = byName.get(normalize(it.alimento));
      if (!food) warnings.push(`Sin datos nutricionales: ${it.alimento}`);
      items.push({ date: m.fecha, slot, nombre: food?.nombre || String(it.alimento), grams: Number(it.gramos) || 0, food });
    }
  }
  return { newFoods, items, warnings };
}

export function claudePrompt({ desde, hasta, foods, req }) {
  const reqTxt = req
    ? `Mi requerimiento diario es ${req.kcal} kcal, ${Math.round(req.prot)} g de proteínas, ${Math.round(req.cho)} g de carbohidratos, ${Math.round(req.lip)} g de lípidos y ${req.fibra} g de fibra; sodio máximo ${req.sodio} mg.`
    : "";
  return `Planifica mis comidas del ${desde} al ${hasta} (desayuno, almuerzo, once y cena; agrega colaciones si hacen falta). ${reqTxt}
Prefiere comidas chilenas, simples y económicas.

Responde SOLO con un bloque JSON con este formato exacto:
{
  "alimentos": [
    {"nombre": "...", "kcal": 0, "prot": 0, "cho": 0, "lip": 0, "fibra": 0, "sodio": 0, "calcio": 0, "hierro": 0}
  ],
  "plan": [
    {"fecha": "AAAA-MM-DD", "tiempo": "Desayuno", "items": [{"alimento": "nombre exacto", "gramos": 0}]}
  ]
}

Reglas:
- "tiempo" debe ser uno de: ${SLOTS.join(", ")}.
- Valores nutricionales por 100 g (sodio, calcio y hierro en mg).
- Usa de preferencia estos alimentos que ya tengo registrados, con el nombre exacto: ${foods.map((f) => f.nombre).join("; ")}.
- En "alimentos" incluye solo los que NO estén en esa lista.`;
}
