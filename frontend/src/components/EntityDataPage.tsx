import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { api } from '@/lib/api'
import {
  RefreshCw, Loader2, ChevronLeft, ChevronRight,
  Search, X, ChevronDown, ChevronRight as ChevronRightIcon,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecordRow {
  id: number
  external_id: string
  workspace_id: string
  data: Record<string, unknown>
  imported_at: string
  updated_at: string
  [key: string]: unknown
}

interface FetchResult {
  total: number
  page: number
  limit: number
  rows: RecordRow[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getField(row: RecordRow, field: string): unknown {
  if (field.startsWith('data.')) {
    const key = field.slice(5)
    return row.data?.[key]
  }
  return row[field]
}

function fmt(val: unknown): string {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'object') {
    const s = JSON.stringify(val)
    return s.length > 70 ? s.slice(0, 70) + '…' : s
  }
  const s = String(val)
  return s.length > 80 ? s.slice(0, 80) + '…' : s
}

function fmtDate(s: unknown): string {
  if (!s) return '—'
  try {
    return new Date(String(s)).toLocaleDateString('pt-PT', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    })
  } catch {
    return String(s)
  }
}

function fmtLabel(field: string): string {
  const name = field.startsWith('data.') ? field.slice(5) : field.replace(/_/g, ' ')
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function extractDataFields(rows: RecordRow[]): string[] {
  const keys = new Set<string>()
  for (const row of rows.slice(0, 40)) {
    if (row.data && typeof row.data === 'object') {
      Object.keys(row.data).forEach(k => keys.add(`data.${k}`))
    }
  }
  return Array.from(keys)
}

// ─── Field Picker ─────────────────────────────────────────────────────────────

function FieldPicker({
  allFields,
  selected,
  onChange,
}: {
  allFields: string[]
  selected: Set<string>
  onChange: (s: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  function toggle(f: string) {
    const next = new Set(selected)
    if (next.has(f)) next.delete(f); else next.add(f)
    onChange(next)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-2 text-sm border border-zinc-700 text-zinc-400 hover:text-white rounded-lg transition-colors whitespace-nowrap"
      >
        Colunas <span className="text-zinc-600 ml-0.5">({selected.size})</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-60 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
            <span className="text-xs text-zinc-400 font-medium">Campos visíveis</span>
            <div className="flex gap-2">
              <button
                onClick={() => onChange(new Set(allFields))}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                todos
              </button>
              <span className="text-zinc-700">·</span>
              <button
                onClick={() => onChange(new Set<string>())}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                nenhum
              </button>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {allFields.map(f => (
              <label
                key={f}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-800 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(f)}
                  onChange={() => toggle(f)}
                  className="accent-brand w-3.5 h-3.5 shrink-0"
                />
                <span className="text-xs text-zinc-300 truncate flex-1">
                  {f.startsWith('data.') ? f.slice(5) : f}
                </span>
                {f.startsWith('data.') && (
                  <span className="text-zinc-600 text-xs shrink-0">json</span>
                )}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({ row }: { row: RecordRow }) {
  const entries = row.data && typeof row.data === 'object'
    ? Object.entries(row.data as Record<string, unknown>)
    : []

  return (
    <div className="px-4 py-4 bg-zinc-800/20">
      {entries.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 mb-4">
          {entries.map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5 min-w-0">
              <span className="text-xs text-zinc-500 font-medium truncate">{k}</span>
              <span className="text-xs text-zinc-300 break-words">
                {v === null || v === undefined
                  ? '—'
                  : typeof v === 'object'
                    ? JSON.stringify(v)
                    : String(v)}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="pt-3 border-t border-zinc-700 flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500">
        <span>ID externo: <span className="text-zinc-300 font-mono">{row.external_id}</span></span>
        <span>Workspace: <span className="text-zinc-300">{row.workspace_id || '—'}</span></span>
        <span>Importado: <span className="text-zinc-300">{fmtDate(row.imported_at)}</span></span>
        <span>Atualizado: <span className="text-zinc-300">{fmtDate(row.updated_at)}</span></span>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

const META_FIELDS = ['workspace_id', 'external_id', 'imported_at', 'updated_at']
const META_DATES  = new Set(['imported_at', 'updated_at'])

interface Props {
  title: string
  subtitle?: string
  table: string
  defaultFields: string[]
  searchPlaceholder?: string
}

export default function EntityDataPage({
  title,
  subtitle,
  table,
  defaultFields,
  searchPlaceholder = 'Pesquisar...',
}: Props) {
  const [rows, setRows]         = useState<RecordRow[]>([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [search, setSearch]     = useState('')
  const [debSearch, setDebSearch] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [allFields, setAllFields] = useState<string[]>(META_FIELDS)
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set(defaultFields))
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const initialised = useRef(false)
  const LIMIT = 50

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setDebSearch(search); setPage(1) }, 400)
    return () => clearTimeout(t)
  }, [search])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
      if (debSearch) params.set('search', debSearch)
      const res = await api.get<FetchResult>(`/api/database/records/${table}?${params}`)
      setRows(res.rows as RecordRow[])
      setTotal(res.total)

      const detected = extractDataFields(res.rows as RecordRow[])
      const merged   = [...META_FIELDS, ...detected]
      setAllFields(merged)

      if (!initialised.current) {
        initialised.current = true
        // Only keep defaultFields that actually exist in data
        const available = new Set(merged)
        setVisibleFields(new Set(defaultFields.filter(f => available.has(f) || !f.startsWith('data.'))))
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar dados')
    } finally {
      setLoading(false)
    }
  }, [table, page, debSearch, defaultFields])

  useEffect(() => { fetchData() }, [fetchData])

  const totalPages = Math.ceil(total / LIMIT)
  const visibleArr = Array.from(visibleFields)

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-semibold text-white">{title}</h2>
          <p className="text-zinc-500 text-sm mt-1">
            {subtitle
              ? subtitle
              : loading && total === 0
                ? 'A carregar…'
                : `${total.toLocaleString('pt-PT')} registos importados`}
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full pl-9 pr-8 py-2 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <FieldPicker allFields={allFields} selected={visibleFields} onChange={setVisibleFields} />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-20 text-zinc-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">A carregar...</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-20 text-center text-sm text-zinc-500">
            Nenhum registo encontrado.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: `${Math.max(640, visibleArr.length * 160)}px` }}>
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                  <th className="w-8 px-3 py-3" />
                  {visibleArr.map(f => (
                    <th key={f} className="text-left px-3 py-3 whitespace-nowrap font-medium">
                      {fmtLabel(f)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isExpanded = expandedRow === i
                  return (
                    <Fragment key={row.id ?? i}>
                      <tr
                        onClick={() => setExpandedRow(isExpanded ? null : i)}
                        className={`border-b border-zinc-800/50 cursor-pointer transition-colors ${
                          isExpanded ? 'bg-zinc-800/60' : 'hover:bg-zinc-800/30'
                        }`}
                      >
                        <td className="px-3 py-2.5 text-zinc-600">
                          {isExpanded
                            ? <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                            : <ChevronRightIcon className="w-3.5 h-3.5" />}
                        </td>
                        {visibleArr.map(f => {
                          const val = getField(row, f)
                          return (
                            <td key={f} className="px-3 py-2.5 text-zinc-300 max-w-[220px] truncate">
                              {META_DATES.has(f) ? fmtDate(val) : fmt(val)}
                            </td>
                          )
                        })}
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-zinc-800/50">
                          <td colSpan={visibleArr.length + 1}>
                            <DetailPanel row={row} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-zinc-500">
          <span>
            Página {page} de {totalPages}
            <span className="ml-2 text-zinc-600">
              ({((page - 1) * LIMIT + 1).toLocaleString('pt-PT')}–{Math.min(page * LIMIT, total).toLocaleString('pt-PT')} de {total.toLocaleString('pt-PT')})
            </span>
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(1)}
              disabled={page <= 1 || loading}
              className="px-2 py-1.5 border border-zinc-700 rounded-lg hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-xs"
            >
              «
            </button>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="p-1.5 border border-zinc-700 rounded-lg hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="p-1.5 border border-zinc-700 rounded-lg hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages || loading}
              className="px-2 py-1.5 border border-zinc-700 rounded-lg hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-xs"
            >
              »
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
