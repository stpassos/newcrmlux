import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import {
  Database, RefreshCw, Loader2, ChevronLeft, ChevronRight, Search, X,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TableStat {
  table:       string
  label:       string
  endpoint:    string
  count:       number
  size_bytes:  number
  size_pretty: string
}

interface ColumnMeta {
  name: string
  type: string
}

interface RecordsResult {
  table:   string
  columns: ColumnMeta[]
  total:   number
  page:    number
  limit:   number
  rows:    Record<string, unknown>[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCount(n: number) {
  return n.toLocaleString('pt-PT')
}

const JSON_TYPES = new Set(['jsonb', 'json', 'ARRAY'])

function cellValue(val: unknown, type: string): string {
  if (val === null || val === undefined) return '—'
  if (JSON_TYPES.has(type)) {
    const s = typeof val === 'string' ? val : JSON.stringify(val)
    return s.length > 60 ? s.slice(0, 60) + '…' : s
  }
  if (typeof val === 'boolean') return val ? 'sim' : 'não'
  const s = String(val)
  return s.length > 80 ? s.slice(0, 80) + '…' : s
}

// Columns we prefer to show first in the data viewer
const PRIORITY_COLS = ['id', 'name', 'email', 'reference', 'status', 'created_at', 'updated_at', 'imported_at']

function sortColumns(cols: ColumnMeta[]): ColumnMeta[] {
  return [...cols].sort((a, b) => {
    const ai = PRIORITY_COLS.indexOf(a.name)
    const bi = PRIORITY_COLS.indexOf(b.name)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return 0
  })
}

// ─── Stats table ──────────────────────────────────────────────────────────────

function StatsTable({
  stats,
  selected,
  onSelect,
}: {
  stats: TableStat[]
  selected: string | null
  onSelect: (table: string) => void
}) {
  const totalRows  = stats.reduce((s, t) => s + t.count, 0)
  const totalBytes = stats.reduce((s, t) => s + t.size_bytes, 0)

  function fmtBytes(b: number) {
    if (b < 1024)       return `${b} B`
    if (b < 1024 ** 2)  return `${(b / 1024).toFixed(1)} KB`
    if (b < 1024 ** 3)  return `${(b / 1024 ** 2).toFixed(1)} MB`
    return `${(b / 1024 ** 3).toFixed(2)} GB`
  }

  const maxBytes = Math.max(...stats.map(t => t.size_bytes), 1)

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
            <th className="text-left px-4 py-3">Endpoint</th>
            <th className="text-left px-4 py-3">Tabela</th>
            <th className="text-right px-4 py-3">Registos</th>
            <th className="text-left px-4 py-3 w-48">Tamanho</th>
            <th className="px-4 py-3 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {stats.map(row => {
            const pct = maxBytes > 0 ? (row.size_bytes / maxBytes) * 100 : 0
            const isSelected = selected === row.table
            return (
              <tr
                key={row.table}
                onClick={() => onSelect(row.table)}
                className={`border-b border-zinc-800/50 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-brand/10 hover:bg-brand/15'
                    : 'hover:bg-zinc-800/40'
                }`}
              >
                <td className="px-4 py-3 font-medium text-zinc-200">{row.label}</td>
                <td className="px-4 py-3 text-zinc-500 font-mono text-xs">{row.table}</td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-200">
                  {fmtCount(row.count)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand/60 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-zinc-400 tabular-nums text-xs w-16 text-right">
                      {row.size_pretty}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-zinc-600 text-xs">
                  {isSelected ? <span className="text-brand">►</span> : null}
                </td>
              </tr>
            )
          })}
          {/* Totals row */}
          <tr className="bg-zinc-900/60 text-zinc-400 text-xs font-medium">
            <td className="px-4 py-2" colSpan={2}>Total</td>
            <td className="px-4 py-2 text-right tabular-nums">{fmtCount(totalRows)}</td>
            <td className="px-4 py-2 text-zinc-500">{fmtBytes(totalBytes)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ─── Record viewer ────────────────────────────────────────────────────────────

function RecordViewer({ tableName, label }: { tableName: string; label: string }) {
  const [data, setData]       = useState<RecordsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage]       = useState(1)
  const [search, setSearch]   = useState('')
  const [searchInput, setSearchInput] = useState('')
  const limit = 50

  const load = useCallback(async (p: number, q: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(limit) })
      if (q) params.set('search', q)
      const res = await api.get<RecordsResult>(`/api/database/records/${tableName}?${params}`)
      setData(res)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [tableName])

  useEffect(() => {
    setPage(1)
    setSearch('')
    setSearchInput('')
  }, [tableName])

  useEffect(() => {
    load(page, search)
  }, [load, page, search])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
    setSearch(searchInput)
  }

  function clearSearch() {
    setSearchInput('')
    setSearch('')
    setPage(1)
  }

  const totalPages = data ? Math.ceil(data.total / limit) : 1
  const visibleCols = data ? sortColumns(data.columns).slice(0, 12) : []

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-zinc-200">{label}</h3>
          {data && (
            <p className="text-xs text-zinc-500 mt-0.5">
              {fmtCount(data.total)} registos · página {page}/{totalPages}
            </p>
          )}
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <input
              type="text"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Pesquisar…"
              className="pl-8 pr-8 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 w-52"
            />
            {searchInput && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-lg transition-colors"
          >
            Filtrar
          </button>
        </form>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          A carregar…
        </div>
      ) : !data || data.rows.length === 0 ? (
        <div className="text-center py-12 text-zinc-600 text-sm">
          {search ? 'Nenhum resultado para a pesquisa.' : 'Tabela vazia.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 uppercase tracking-wider">
                {visibleCols.map(col => (
                  <th key={col.name} className="text-left px-3 py-2.5 whitespace-nowrap font-medium">
                    {col.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-zinc-800/40 hover:bg-zinc-800/30 transition-colors"
                >
                  {visibleCols.map(col => (
                    <td
                      key={col.name}
                      className="px-3 py-2 text-zinc-300 whitespace-nowrap max-w-[220px] overflow-hidden text-ellipsis"
                      title={String(row[col.name] ?? '')}
                    >
                      {cellValue(row[col.name], col.type)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Anterior
          </button>
          <span className="text-xs text-zinc-500">
            {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} de {fmtCount(data.total)}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Seguinte <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DatabaseTab() {
  const [stats, setStats]         = useState<TableStat[]>([])
  const [loading, setLoading]     = useState(true)
  const [selectedTable, setSelectedTable] = useState<string | null>(null)

  const loadStats = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<{ tables: TableStat[] }>('/api/database/stats')
      setStats(res.tables)
    } catch {
      setStats([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  const selectedMeta = stats.find(s => s.table === selectedTable)

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-zinc-800">
            <Database className="w-5 h-5 text-zinc-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-200">Base de Dados</h2>
            <p className="text-xs text-zinc-500">Registos por entidade importada do 21online.app</p>
          </div>
        </div>
        <button
          onClick={loadStats}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {/* Stats table */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          A carregar estatísticas…
        </div>
      ) : (
        <>
          <div>
            <p className="text-xs text-zinc-500 mb-3">
              Clique numa linha para explorar os registos dessa entidade.
            </p>
            <StatsTable
              stats={stats}
              selected={selectedTable}
              onSelect={t => setSelectedTable(prev => prev === t ? null : t)}
            />
          </div>

          {/* Record viewer */}
          {selectedTable && selectedMeta && (
            <div className="border border-zinc-800 rounded-xl p-6 space-y-4">
              <RecordViewer
                key={selectedTable}
                tableName={selectedTable}
                label={selectedMeta.label}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
