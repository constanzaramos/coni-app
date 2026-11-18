# Mi Centro · Coni (v2)

Página web responsive para el celular, con seis secciones:

| Sección | Qué hace | Dónde se guardan los datos |
|---|---|---|
| **Hoy** | Resumen: tareas, kcal del día, estudio, lo urgente de Coramba | — |
| **Gestiones** | Tareas personales y de la casa | Firestore |
| **Estudio** | Chino HSK 1 (contador de 300 palabras) y certificado de Google en Coursera (checklist de 8 cursos), horas por sesión | Firestore |
| **Comida** | Plan vs. ingesta real, nutrientes, requerimientos, alimentos, compras | Firestore |
| **Coramba** | Puesta en marcha, sitio Shopify y agenda **leídos desde Notion** (Coramba OS); clientes y cobros | Notion + Firestore |
| **Casa** | Gastos del mes, cuentas básicas y cierre Coni/David | **Notion** (Nuestro Hogar › Gastos del hogar) |

## Arquitectura

```
Celular ──► Vercel (página + función /api/notion) ──► Notion API
   │
   └──► Firebase (login con Google + Firestore)
```

- `public/`: la página (HTML, CSS y JS sin build).
- `api/notion.js`: función serverless. Guarda el token de Notion en el servidor, revisa que quien llama seas tú (token de Firebase y correo permitido) y solo puede tocar las 4 bases de Notion configuradas.
- `firestore.rules`: solo tu cuenta lee y escribe tus datos.

## Puesta en marcha

### 1. Firebase (login y base de datos)
1. https://console.firebase.google.com → crear proyecto.
2. Authentication → Método de acceso → habilitar **Google**.
3. Firestore Database → crear (modo producción, región `southamerica-east1`).
4. Firestore → Reglas → pega el contenido de `firestore.rules` → Publicar.
5. Configuración del proyecto → Tus apps → `</>` → copia `firebaseConfig` en `public/firebase-config.js`.

### 2. Notion (integración)
1. https://www.notion.so/profile/integrations → **Nueva integración** (interna), con permisos de leer, actualizar e insertar contenido.
2. Copia el **Internal Integration Secret** (empieza con `ntn_`).
3. En Notion abre **Coramba OS** → `•••` → Conexiones → agrega tu integración. Haz lo mismo en **Nuestro Hogar**.
   (Así la integración ve las bases de esas páginas y nada más).

### 3. Vercel (publicación)
1. Sube esta carpeta a un repositorio de GitHub.
2. https://vercel.com → Add New Project → importa el repo (Framework: *Other*).
3. Environment Variables:

   | Variable | Valor |
   |---|---|
   | `NOTION_TOKEN` | el secreto de la integración |
   | `FIREBASE_PROJECT_ID` | el `projectId` de Firebase |
   | `ALLOWED_EMAILS` | tu correo de Google (separa con comas si agregas otro) |

4. Deploy. Copia el dominio (ej. `mi-centro.vercel.app`) y agrégalo en Firebase → Authentication → Configuración → **Dominios autorizados**.
5. En el celular: abre el sitio → compartir → "Agregar a pantalla de inicio".

Para probar en tu computador: `npm i -g vercel` y luego `vercel dev`.

## Alimentación: cómo se usa

1. **Alimentos** → "Cargar alimentos base": 33 alimentos con valores referenciales por 100 g (USDA). Puedes editar o agregar los tuyos desde la tabla de composición que prefieras.
2. **Análisis** → completa "Mis requerimientos". La energía se calcula con Mifflin-St Jeor × factor de actividad, o con kcal manual. Los macronutrientes salen de los % que definas, y fibra, sodio, calcio y hierro son editables.
3. **Semana** → "Copiar instrucciones para esta semana" → pégalas en Claude → pega el JSON de respuesta → **Importar plan**. Si un alimento nuevo trae sus valores, se crea solo. Si no, queda marcado como "sin datos".
4. **Día** → registra lo que comiste (alimento + gramos) o toca "✓ Comí lo planificado".
5. **Análisis** → tabla por nutriente con meta, plan, real, % de adecuación y diferencia real − plan, por día o promedio semanal. El color es verde si está entre 90 y 110 %; el sodio se evalúa como máximo.
6. **Compras** → "Agregar lo del plan de la semana" arma la lista con los alimentos planificados.

## Casa: cómo se calcula el cierre

Usa las fórmulas de tu base en Notion (*Aporte Coni*, *Aporte David*, *Balance Coni*).
Si una fila no trae la fórmula, la app aplica el mismo reparto: Proporcional 29 % / 71 %, 50/50, Solo Coni o Solo David.
Si cambia el porcentaje, actualízalo en Notion y en `SHARE_CONI` (archivo `public/app.js`).

## Seguridad

- El token de Notion solo vive en Vercel, nunca en el navegador.
- La función rechaza a cualquier cuenta que no esté en `ALLOWED_EMAILS`. Además, antes de cambiar o borrar una página, revisa que pertenezca a la base correcta.
- Los gastos que borras desde la app van a la papelera de Notion (se pueden recuperar).
