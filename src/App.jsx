import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'

// Categorías auto-generadas por palabras clave (si no hay coincidencia: "Otros")
const CATS = {
  Granos: ['arroz', 'avena', 'lenteja', 'fréjol', 'frejol', 'maíz', 'quinua', 'cebada', 'harina', 'trigo', 'arveja'],
  Lácteos: ['leche', 'queso', 'yogur', 'mantequilla', 'huevo'],
  Limpieza: ['jabón', 'jabon', 'detergente', 'cloro', 'desinfectante', 'papel', 'suavizante', 'escoba'],
  Carnes: ['pollo', 'carne', 'pescado', 'atún', 'atun', 'chancho', 'res'],
  Verduras: ['papa', 'cebolla', 'tomate', 'zanahoria', 'ajo', 'plátano', 'platano'],
  Abarrotes: ['aceite', 'azúcar', 'azucar', 'sal', 'fideo', 'pasta', 'café', 'cafe', 'sardina'],
}
const adivinarCategoria = (n) => {
  const s = n.toLowerCase()
  for (const [c, k] of Object.entries(CATS)) if (k.some((w) => s.includes(w))) return c
  return 'Otros'
}
const $ = (n) => '$' + Number(n || 0).toFixed(2)

export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('usuario') || 'null'))
  const [productos, setProductos] = useState([])
  const [lista, setLista] = useState([])
  const [tab, setTab] = useState('lista')
  const [toast, setToast] = useState(null)
  const [escaneando, setEscaneando] = useState(false)
  const [prefill, setPrefill] = useState(null)
  const prodRef = useRef([])
  prodRef.current = productos

  const cargar = async () => {
    const [p, l] = await Promise.all([
      supabase.from('productos_inventario').select('*').order('nombre'),
      supabase.from('lista_compra_activa')
        .select('*, productos_inventario(nombre,categoria,unidad,ultimo_precio)')
        .order('creado_en'),
    ])
    if (p.data) setProductos(p.data)
    if (l.data) setLista(l.data)
  }

  const avisar = (msg) => {
    setToast(msg)
    navigator.vibrate?.(200)
    if (window.Notification?.permission === 'granted') new Notification('Mercado Familiar', { body: msg })
    setTimeout(() => setToast(null), 4000)
  }

  // Realtime: cualquier cambio de otro miembro se refleja al instante
  useEffect(() => {
    if (!user) return
    cargar()
    window.Notification?.requestPermission?.()
    const ch = supabase.channel('familia')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lista_compra_activa' }, (p) => {
        cargar()
        if (p.eventType === 'INSERT' && p.new.reportado_por !== user.id) {
          const prod = prodRef.current.find((x) => x.id === p.new.producto_id)
          avisar(`⚠️ Se agotó: ${prod?.nombre ?? 'un producto'}`)
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'productos_inventario' }, cargar)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [user])

  const entrar = async (nombre) => {
    const { data, error } = await supabase.from('usuarios').insert({ nombre }).select().single()
    if (error) { alert('No se pudo entrar: ' + error.message); return }
    localStorage.setItem('usuario', JSON.stringify(data)); setUser(data)
  }

  // Acciones (cada una refresca la pantalla y muestra errores)
  const run = async (q) => {
    const { error } = await q
    if (error) alert('Error: ' + error.message)
    await cargar()
  }
  const reportar = (p) =>
    run(supabase.from('lista_compra_activa').insert({ producto_id: p.id, cantidad: p.cantidad, reportado_por: user.id }))
  const tachar = (it) =>
    run(supabase.from('lista_compra_activa')
      .update({ comprado: !it.comprado, comprado_por: it.comprado ? null : user.id }).eq('id', it.id))
  const quitar = (it) => run(supabase.from('lista_compra_activa').delete().eq('id', it.id))
  const editarPrecio = async (it) => {
    const actual = it.precio_real ?? it.productos_inventario.ultimo_precio
    const v = parseFloat((prompt('Precio real cobrado (por unidad):', actual) || '').replace(',', '.'))
    if (isNaN(v)) return
    await run(supabase.from('lista_compra_activa').update({ precio_real: v }).eq('id', it.id))
    await run(supabase.from('productos_inventario').update({ ultimo_precio: v }).eq('id', it.producto_id)) // histórico
  }
  const editarProducto = (id, f) =>
    run(supabase.from('productos_inventario').update({ ...f, categoria: f.categoria || adivinarCategoria(f.nombre) }).eq('id', id))
  const eliminarProducto = (p) => {
    if (confirm(`¿Eliminar "${p.nombre}" del inventario?`)) run(supabase.from('productos_inventario').delete().eq('id', p.id))
  }
  const limpiarComprados = () => run(supabase.from('lista_compra_activa').delete().eq('comprado', true))
  const agregarProducto = (f) =>
    run(supabase.from('productos_inventario').insert({ ...f, categoria: f.categoria || adivinarCategoria(f.nombre) }))

  // Escáner: producto conocido -> solo pide cantidad; desconocido -> prellena el formulario
  const alEscanear = async (codigo) => {
    setEscaneando(false)
    const p = productos.find((x) => x.codigo === codigo)
    if (p) {
      if (lista.some((i) => i.producto_id === p.id && !i.comprado)) return alert(`"${p.nombre}" ya está en la lista.`)
      const c = parseFloat((prompt(`${p.nombre} · ${$(p.ultimo_precio)}\n¿Cuántas ${p.unidad} necesitas?`, p.cantidad) || '').replace(',', '.'))
      if (isNaN(c) || c <= 0) return
      await run(supabase.from('lista_compra_activa').insert({ producto_id: p.id, cantidad: c, reportado_por: user.id }))
      setTab('lista')
      return
    }
    let nombre = /^\d+$/.test(codigo) ? '' : codigo // QR con texto = nombre directo
    if (/^\d+$/.test(codigo)) {
      try {
        const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(codigo)}.json?fields=product_name,brands`)
        const j = await r.json()
        if (j.status === 1) nombre = [j.product.product_name, j.product.brands?.split(',')[0]].filter(Boolean).join(' - ')
      } catch {}
    }
    setTab('inv')
    setPrefill({ nombre, codigo })
  }

  // Presupuesto en vivo
  const precioDe = (it) => it.precio_real ?? it.productos_inventario?.ultimo_precio ?? 0
  const estimado = lista.reduce((s, it) => s + it.cantidad * precioDe(it), 0)
  const gastado = lista.filter((i) => i.comprado).reduce((s, it) => s + it.cantidad * precioDe(it), 0)

  const grupos = useMemo(() => {
    const g = {}
    lista.forEach((it) => { (g[it.productos_inventario?.categoria ?? 'Otros'] ??= []).push(it) })
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b))
  }, [lista])

  if (!user) return <Bienvenida onEntrar={entrar} />
  const pendientes = new Set(lista.filter((i) => !i.comprado).map((i) => i.producto_id))

  return (
    <div className="mx-auto min-h-screen max-w-md pb-28">
      <header className="sticky top-0 z-10 bg-green-700 p-4 text-white shadow-lg">
        <div className="flex items-center justify-between text-sm"><b>🛒 Mercado Familiar</b><span>Hola, {user.nombre}</span></div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <Dato t="Estimado" v={$(estimado)} /><Dato t="Gastado" v={$(gastado)} /><Dato t="Falta" v={$(estimado - gastado)} />
        </div>
      </header>

      {toast && <div className="fixed inset-x-4 top-24 z-20 mx-auto max-w-md rounded-2xl bg-amber-400 p-4 text-lg font-bold shadow-xl">{toast}</div>}

      {tab === 'lista' ? (
        <main className="space-y-5 p-4">
          {grupos.length === 0 && <p className="py-16 text-center text-lg text-stone-500">Nada pendiente 🎉<br />Reporta faltantes desde “Inventario”.</p>}
          {grupos.map(([cat, items]) => (
            <section key={cat}>
              <h2 className="mb-2 text-xl font-extrabold uppercase tracking-wide text-green-800">{cat}</h2>
              <ul className="space-y-2">
                {items.map((it) => (
                  <li key={it.id} className={`flex items-center gap-2 rounded-2xl border-2 p-2 ${it.comprado ? 'border-stone-300 bg-stone-200 opacity-60' : 'border-green-700 bg-white'}`}>
                    <button onClick={() => tachar(it)} className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-green-100 text-3xl" aria-label="Tachar">
                      {it.comprado ? '✅' : '⬜'}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-lg font-bold ${it.comprado ? 'line-through' : ''}`}>{it.productos_inventario?.nombre}</p>
                      <p className="text-base text-stone-600">{it.cantidad} {it.productos_inventario?.unidad}</p>
                    </div>
                    <button onClick={() => editarPrecio(it)} className="h-16 shrink-0 rounded-xl bg-amber-100 px-3 text-lg font-extrabold">
                      {$(precioDe(it))}{it.precio_real != null && ' ✎'}
                    </button>
                    <button onClick={() => quitar(it)} className="h-16 w-10 text-xl text-stone-400" aria-label="Quitar">✕</button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {lista.some((i) => i.comprado) && (
            <button onClick={limpiarComprados} className="h-14 w-full rounded-2xl bg-stone-800 text-lg font-bold text-white">Limpiar comprados</button>
          )}
        </main>
      ) : (
        <Inventario productos={productos} pendientes={pendientes} onReportar={reportar} onAgregar={agregarProducto} onEditar={editarProducto} onEliminar={eliminarProducto} prefill={prefill} onPrefillUsado={() => setPrefill(null)} />
      )}

      {escaneando && <Escaner onCodigo={alEscanear} onCerrar={() => setEscaneando(false)} />}

      <nav className="fixed inset-x-0 bottom-0 mx-auto grid max-w-md grid-cols-[1fr_auto_1fr] gap-2 border-t bg-white p-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        {[['lista', `🧾 Lista (${lista.filter((i) => !i.comprado).length})`]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`h-14 rounded-2xl text-base font-bold ${tab === k ? 'bg-green-700 text-white' : 'bg-stone-100'}`}>{l}</button>
        ))}
        <button onClick={() => setEscaneando(true)} className="h-14 w-16 rounded-2xl bg-amber-400 text-3xl shadow" aria-label="Escanear código">📷</button>
        {[['inv', '📦 Inventario']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`h-14 rounded-2xl text-base font-bold ${tab === k ? 'bg-green-700 text-white' : 'bg-stone-100'}`}>{l}</button>
        ))}
      </nav>
    </div>
  )
}

const Dato = ({ t, v }) => (
  <div className="rounded-xl bg-green-800 py-1"><div className="text-xs opacity-80">{t}</div><div className="text-xl font-extrabold">{v}</div></div>
)

function Bienvenida({ onEntrar }) {
  const [n, setN] = useState('')
  return (
    <div className="mx-auto grid min-h-screen max-w-md content-center gap-4 p-6">
      <h1 className="text-3xl font-extrabold text-green-800">🛒 Mercado Familiar</h1>
      <p className="text-lg">¿Cómo te llamas?</p>
      <input value={n} onChange={(e) => setN(e.target.value)} className="h-14 rounded-2xl border-2 border-green-700 px-4 text-xl" placeholder="Ej. Mamá" />
      <button disabled={!n.trim()} onClick={() => onEntrar(n.trim())} className="h-14 rounded-2xl bg-green-700 text-xl font-bold text-white disabled:opacity-40">Entrar</button>
    </div>
  )
}

function Inventario({ productos, pendientes, onReportar, onAgregar, onEditar, onEliminar, prefill, onPrefillUsado }) {
  const vacio = { nombre: '', cantidad: 1, unidad: 'fundas', ultimo_precio: 0, categoria: '', codigo: '' }
  const [f, setF] = useState(vacio)
  const [editId, setEditId] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const inp = 'h-12 rounded-xl border-2 border-stone-300 px-3 text-lg'
  useEffect(() => {
    if (!prefill) return
    setF({ ...vacio, nombre: prefill.nombre, codigo: prefill.codigo })
    setEditId(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    onPrefillUsado()
  }, [prefill])

  const empezarEdicion = (p) => {
    setF({ nombre: p.nombre, cantidad: p.cantidad, unidad: p.unidad, ultimo_precio: p.ultimo_precio, categoria: p.categoria, codigo: p.codigo || '' })
    setEditId(p.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const cancelar = () => { setF(vacio); setEditId(null) }
  const guardar = () => {
    const d = { ...f, cantidad: +f.cantidad, ultimo_precio: +f.ultimo_precio, codigo: f.codigo || null }
    editId ? onEditar(editId, d) : onAgregar(d)
    cancelar()
  }

  return (
    <main className="space-y-4 p-4">
      <div className={`grid grid-cols-2 gap-2 rounded-2xl bg-white p-3 ${editId ? 'border-4 border-amber-400' : ''}`}>
        {editId && <p className="col-span-2 text-lg font-extrabold text-amber-700">✏️ Editando producto</p>}
        {f.codigo && <p className="col-span-2 rounded-xl bg-green-50 p-2 text-sm">📷 Código <b>{f.codigo}</b>. Escribe el precio solo esta vez; la próxima se llena automático.</p>}
        <input className={`${inp} col-span-2`} placeholder="Producto (ej. Harina)" value={f.nombre} onChange={set('nombre')} />
        <label className="text-sm font-bold">Cantidad<input className={`${inp} w-full`} type="number" inputMode="decimal" value={f.cantidad} onChange={set('cantidad')} /></label>
        <label className="text-sm font-bold">Unidad<input className={`${inp} w-full`} placeholder="fundas, libras" value={f.unidad} onChange={set('unidad')} /></label>
        <label className="text-sm font-bold">Precio $ por unidad<input className={`${inp} w-full`} type="number" inputMode="decimal" step="0.01" value={f.ultimo_precio} onChange={set('ultimo_precio')} /></label>
        <label className="text-sm font-bold">Categoría (opcional)<input className={`${inp} w-full`} placeholder="se pone sola" value={f.categoria} onChange={set('categoria')} /></label>
        <button disabled={!f.nombre.trim()} onClick={guardar}
          className={`h-14 rounded-2xl text-lg font-bold text-white disabled:opacity-40 ${editId ? 'col-span-1 bg-amber-600' : 'col-span-2 bg-green-700'}`}>
          {editId ? 'Guardar cambios' : '+ Agregar al inventario'}
        </button>
        {editId && <button onClick={cancelar} className="h-14 rounded-2xl bg-stone-200 text-lg font-bold">Cancelar</button>}
      </div>
      <ul className="space-y-2">
        {productos.map((p) => (
          <li key={p.id} className={`rounded-2xl bg-white p-2 ${editId === p.id ? 'ring-4 ring-amber-400' : ''}`}>
            <div className="px-2 pb-2">
              <p className="truncate text-lg font-bold">{p.nombre}</p>
              <p className="text-sm text-stone-600">{p.categoria} · {p.cantidad} {p.unidad} · {$(p.ultimo_precio)}</p>
            </div>
            <div className="grid grid-cols-[1fr_auto_auto] gap-2">
              <button disabled={pendientes.has(p.id)} onClick={() => onReportar(p)}
                className="h-14 rounded-xl bg-red-600 text-base font-extrabold text-white disabled:bg-stone-300 disabled:text-stone-500">
                {pendientes.has(p.id) ? 'En lista' : '¡Se agotó!'}
              </button>
              <button onClick={() => empezarEdicion(p)} className="h-14 w-14 rounded-xl bg-amber-100 text-2xl" aria-label="Editar">✏️</button>
              <button onClick={() => onEliminar(p)} className="h-14 w-14 rounded-xl bg-stone-100 text-2xl" aria-label="Eliminar">🗑</button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  )
}

function Escaner({ onCodigo, onCerrar }) {
  const [err, setErr] = useState('')
  const [manual, setManual] = useState('')
  useEffect(() => {
    let sc, activo = true
    import('html5-qrcode').then(({ Html5Qrcode, Html5QrcodeSupportedFormats: F }) => {
      sc = new Html5Qrcode('lector', {
        formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF, F.QR_CODE],
        useBarCodeDetectorIfSupported: true,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        verbose: false,
      })
      sc.start(
        { facingMode: 'environment' },
        {
          fps: 15,
          qrbox: (w, h) => ({ width: Math.floor(w * 0.9), height: Math.floor(Math.min(h * 0.6, 220)) }),
          videoConstraints: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        },
        (txt) => { if (activo) { activo = false; sc.stop().catch(() => {}).finally(() => onCodigo(txt)) } },
        () => {}
      ).catch(() => setErr('No se pudo abrir la cámara. Permite el acceso a la cámara para este sitio.'))
    })
    return () => { activo = false; try { sc?.isScanning && sc.stop().catch(() => {}) } catch {} }
  }, [])
  return (
    <div className="fixed inset-0 z-30 grid place-items-center overflow-y-auto bg-black/80 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-4">
        <p className="mb-1 text-xl font-extrabold">📷 Apunta al código de barras o QR</p>
        <p className="mb-2 text-sm text-stone-600">Buena luz, a unos 10–15 cm, código horizontal y quieto.</p>
        <div id="lector" className="overflow-hidden rounded-2xl" />
        {err && <p className="mt-2 font-bold text-red-700">{err}</p>}
        <div className="mt-3 flex gap-2">
          <input value={manual} onChange={(e) => setManual(e.target.value.trim())} inputMode="numeric" placeholder="O escribe el número del código"
            className="h-12 min-w-0 flex-1 rounded-xl border-2 border-stone-300 px-3 text-lg" />
          <button disabled={!manual} onClick={() => onCodigo(manual)} className="h-12 rounded-xl bg-green-700 px-4 font-bold text-white disabled:opacity-40">Usar</button>
        </div>
        <button onClick={onCerrar} className="mt-3 h-14 w-full rounded-2xl bg-stone-800 text-lg font-bold text-white">Cerrar</button>
      </div>
    </div>
  )
}
