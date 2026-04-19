import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import {
  Play, Square, RefreshCw, Loader2, GripVertical,
  CheckCircle2, XCircle, Clock, AlertTriangle, Minus,
  ToggleLeft, ToggleRight, ChevronDown, ChevronUp, Settings,
  Database, History, Zap, CalendarX, Timer, Ban, Download, Trash2
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Pipeline {
  id: string
  worker_name: string
  worker_url: string
  interval_min: number
  interval_max: number
  status: 'not_configured' | 'ready' | 'running' | 'stopped' | 'error'
  is_active: boolean
  started_at: string | null
  stopped_at: string | null
  created_at: string
  updated_at: string
}

interface PipelineEndpoint {
  id: string
  pipeline_id: string
  sort_order: number
  endpoint_name: string
  endpoint_path: string
  workspace_id: string | null
  workspace_name: string | null
  credential_id: string | null
  credential_name: string | null
  credential_email: string | null
  active_from: string | null
  active_to: string | null
  active_days: number[]
  backfill_mode: 'full' | 'incremental' | 'from_date'
  backfill_from_date: string | null
  incremental_months: number
  runs_per_day: number | null
  runs_today: number
  is_active: boolean
  status: 'idle' | 'running' | 'done' | 'error' | 'waiting'
  last_run_at: string | null
  last_fetched: number
  last_inserted: number
  last_skipped: number
  last_failed: number
}

interface PipelineJob {
  id: string
  pipeline_id: string
  endpoint_id: string | null
  workspace_id: string | null
  workspace_name: string | null
  credential_id: string | null
  credential_name: string | null
  entity: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  progress: number
  fetched: number
  inserted: number
  skipped: number
  failed: number
  error_msg: string | null
  started_at: string
  finished_at: string | null
  duration_ms: number | null
}

interface Workspace {
  id?: string
  external_id?: string
  name?: string
  slug?: string
  [key: string]: unknown
}

interface Credential {
  id: string
  name: string
  email: string
  is_active: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_LABELS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']
const DAY_NUMBERS = [1, 2, 3, 4, 5, 6, 7]

const STATUS_CONFIG = {
  not_configured: { label: 'Não configurado', color: 'text-zinc-500', bg: 'bg-zinc-800' },
  ready:          { label: 'Pronto',          color: 'text-blue-400',  bg: 'bg-blue-500/10' },
  running:        { label: 'A correr',        color: 'text-green-400', bg: 'bg-green-500/10' },
  stopped:        { label: 'Parado',          color: 'text-yellow-400',bg: 'bg-yellow-500/10' },
  error:          { label: 'Erro',            color: 'text-red-400',   bg: 'bg-red-500/10' },
}

const EP_STATUS_CONFIG = {
  idle:    { label: 'Idle',    icon: <Minus className="w-3 h-3" />,         color: 'text-zinc-500' },
  running: { label: 'A correr',icon: <Loader2 className="w-3 h-3 animate-spin" />, color: 'text-green-400' },
  done:    { label: 'Feito',   icon: <CheckCircle2 className="w-3 h-3" />,  color: 'text-green-400' },
  error:   { label: 'Erro',    icon: <XCircle className="w-3 h-3" />,       color: 'text-red-400' },
  waiting: { label: 'Espera',  icon: <Clock className="w-3 h-3" />,         color: 'text-yellow-400' },
}

// ─── Schedule Status ─────────────────────────────────────────────────────────

type SkipReason = 'runs_limit' | 'wrong_day' | 'wrong_time' | null

function getSkipReason(ep: PipelineEndpoint): SkipReason {
  const now = new Date()
  const jsDay = now.getDay()
  const isoDay = jsDay === 0 ? 7 : jsDay
  if (ep.active_days?.length > 0 && !ep.active_days.includes(isoDay)) return 'wrong_day'
  if (ep.active_from && ep.active_to) {
    const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
    const activeTo = ep.active_to.slice(0, 5)
    const afterEnd = activeTo !== '00:00' && hhmm >= activeTo
    if (hhmm < ep.active_from.slice(0, 5) || afterEnd) return 'wrong_time'
  }
  if (ep.runs_per_day && ep.runs_today >= ep.runs_per_day) return 'runs_limit'
  return null
}

const SKIP_CONFIG: Record<NonNullable<SkipReason>, { icon: JSX.Element; label: string; color: string }> = {
  runs_limit:  { icon: <Ban className="w-3.5 h-3.5" />,      label: 'Limite diário atingido', color: 'text-orange-400' },
  wrong_day:   { icon: <CalendarX className="w-3.5 h-3.5" />, label: 'Fora do dia configurado', color: 'text-zinc-500' },
  wrong_time:  { icon: <Timer className="w-3.5 h-3.5" />,     label: 'Fora do horário configurado', color: 'text-zinc-500' },
}

// ─── Endpoint Card ────────────────────────────────────────────────────────────

interface EndpointCardProps {
  ep: PipelineEndpoint
  index: number
  isRunning: boolean
  workspaces: Workspace[]
  credentials: Credential[]
  onSave: (id: string, data: Partial<PipelineEndpoint>) => Promise<void>
  onToggle: (id: string, is_active: boolean) => Promise<void>
  onManualBackfill: (id: string) => Promise<void>
  // drag-and-drop
  draggingId: string | null
  onDragStart: (id: string) => void
  onDragOver: (id: string) => void
  onDragEnd: () => void
}

function EndpointCard({
  ep, index, isRunning, workspaces, credentials,
  onSave, onToggle, onManualBackfill,
  draggingId, onDragStart, onDragOver, onDragEnd,
}: EndpointCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [backfilling, setBackfilling] = useState(false)
  const [draft, setDraft] = useState<Partial<PipelineEndpoint>>({})

  const isDragging = draggingId === ep.id
  const isHighlighted = ep.status === 'running'

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(ep.id, draft)
      setDraft({})
    } finally {
      setSaving(false)
    }
  }

  const hasDraft = Object.keys(draft).length > 0

  const wsId = (ws: Workspace) => ws.id ?? ws.external_id ?? ws.slug ?? ''
  const wsName = (ws: Workspace) => (ws.name ?? ws.slug ?? 'Workspace') as string

  return (
    <div
      draggable
      onDragStart={() => onDragStart(ep.id)}
      onDragOver={e => { e.preventDefault(); onDragOver(ep.id) }}
      onDragEnd={onDragEnd}
      className={`border rounded-xl transition-all ${
        isHighlighted
          ? 'border-green-500/50 bg-green-950/10 shadow-green-900/20 shadow-md'
          : isDragging
            ? 'border-brand/50 bg-zinc-800/80 opacity-60'
            : 'border-zinc-800 bg-zinc-900'
      }`}
    >
      {/* Card header */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Drag handle */}
        <div className="cursor-grab text-zinc-700 hover:text-zinc-500 shrink-0">
          <GripVertical className="w-4 h-4" />
        </div>

        {/* Order badge */}
        <span className="text-zinc-600 text-xs font-mono w-5 shrink-0">{index + 1}</span>

        {/* Status icon */}
        <span
          className={`relative group ${EP_STATUS_CONFIG[ep.status].color}`}
          title={EP_STATUS_CONFIG[ep.status].label}
        >
          {EP_STATUS_CONFIG[ep.status].icon}
          <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 whitespace-nowrap rounded bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-xs text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity z-50">
            {EP_STATUS_CONFIG[ep.status].label}
          </span>
        </span>

        {/* Skip reason icon */}
        {(() => {
          const reason = getSkipReason(ep)
          if (!reason) return null
          const cfg = SKIP_CONFIG[reason]
          return (
            <span className={cfg.color} title={cfg.label}>
              {cfg.icon}
            </span>
          )
        })()}

        {/* Name & path */}
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium">{ep.endpoint_name}</p>
          <p className="text-zinc-600 text-xs font-mono truncate">{ep.endpoint_path}</p>
        </div>

        {/* Stats */}
        {(ep.last_fetched > 0 || ep.last_inserted > 0) && (
          <div className="hidden md:flex items-center gap-3 text-xs text-zinc-600 shrink-0">
            <span className="text-zinc-400">{ep.last_fetched} fetch</span>
            <span className="text-green-600">{ep.last_inserted} ins</span>
            <span className="text-zinc-600">{ep.last_skipped} skip</span>
            {ep.last_failed > 0 && <span className="text-red-500">{ep.last_failed} fail</span>}
          </div>
        )}

        {/* Active toggle */}
        <button
          onClick={() => onToggle(ep.id, !ep.is_active)}
          title={ep.is_active ? 'Desativar' : 'Ativar'}
          className="shrink-0"
        >
          {ep.is_active
            ? <ToggleRight className="w-5 h-5 text-green-400" />
            : <ToggleLeft className="w-5 h-5 text-zinc-600" />}
        </button>

        {/* Manual backfill */}
        <button
          onClick={async () => {
            setBackfilling(true)
            try { await onManualBackfill(ep.id) } finally { setBackfilling(false) }
          }}
          disabled={backfilling}
          title="Backfill Manual"
          className="shrink-0 text-zinc-500 hover:text-brand disabled:opacity-40 transition-colors"
        >
          {backfilling
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Download className="w-4 h-4" />}
        </button>

        {/* Expand */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-zinc-600 hover:text-zinc-400 shrink-0"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expanded config */}
      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Workspace */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">Workspace</label>
              <select
                value={draft.workspace_id ?? ep.workspace_id ?? ''}
                onChange={e => {
                  const ws = workspaces.find(w => wsId(w) === e.target.value)
                  setDraft(d => ({
                    ...d,
                    workspace_id: e.target.value || null,
                    workspace_name: ws ? wsName(ws) : null,
                  }))
                }}
                className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand appearance-none"
              >
                <option value="">— Todos os workspaces —</option>
                {workspaces.map((ws, i) => (
                  <option key={wsId(ws) || String(i)} value={wsId(ws)}>
                    {wsName(ws)}
                  </option>
                ))}
              </select>
            </div>

            {/* Credential */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">Credencial</label>
              <select
                value={draft.credential_id ?? ep.credential_id ?? ''}
                onChange={e => setDraft(d => ({ ...d, credential_id: e.target.value || null }))}
                className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand appearance-none"
              >
                <option value="">— Credencial padrão —</option>
                {credentials.map(c => (
                  <option key={c.id} value={c.id}>{c.name} · {c.email}</option>
                ))}
              </select>
            </div>

            {/* Active hours */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">Horário ativo (de / até)</label>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={(draft.active_from ?? ep.active_from ?? '').slice(0, 5)}
                  onChange={e => setDraft(d => ({ ...d, active_from: e.target.value || null }))}
                  className="flex-1 bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand"
                />
                <span className="text-zinc-600 text-xs shrink-0">até</span>
                <input
                  type="time"
                  value={(draft.active_to ?? ep.active_to ?? '').slice(0, 5)}
                  onChange={e => setDraft(d => ({ ...d, active_to: e.target.value || null }))}
                  className="flex-1 bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand"
                />
              </div>
            </div>

            {/* Backfill mode */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">Modo backfill</label>
              <div className="flex gap-2">
                {(['full', 'incremental', 'from_date'] as const).map(mode => {
                  const current = draft.backfill_mode ?? ep.backfill_mode
                  const labels = { full: 'Completo', incremental: 'Incremental', from_date: 'A partir de' }
                  return (
                    <button
                      key={mode}
                      onClick={() => setDraft(d => ({ ...d, backfill_mode: mode }))}
                      className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                        current === mode
                          ? 'border-brand bg-brand/10 text-brand'
                          : 'border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800'
                      }`}
                    >
                      {labels[mode]}
                    </button>
                  )
                })}
              </div>
              {(draft.backfill_mode ?? ep.backfill_mode) === 'from_date' && (
                <input
                  type="date"
                  value={draft.backfill_from_date ?? ep.backfill_from_date ?? ''}
                  onChange={e => setDraft(d => ({ ...d, backfill_from_date: e.target.value || null }))}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand mt-2"
                />
              )}
            </div>

            {/* Incremental months — only visible in incremental mode */}
            {(draft.backfill_mode ?? ep.backfill_mode) === 'incremental' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400">Meses incremental</label>
                <input
                  type="number" min={1} max={60}
                  value={draft.incremental_months ?? ep.incremental_months ?? 14}
                  onChange={e => setDraft(d => ({ ...d, incremental_months: Number(e.target.value) }))}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand"
                />
                <p className="text-zinc-600 text-xs">Número de meses à frente a importar no modo incremental</p>
              </div>
            )}

            {/* Runs per day */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">Execuções por dia</label>
              <input
                type="number" min={1} max={100}
                placeholder="Ilimitado"
                value={draft.runs_per_day ?? ep.runs_per_day ?? ''}
                onChange={e => setDraft(d => ({ ...d, runs_per_day: e.target.value ? Number(e.target.value) : null }))}
                className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand"
              />
              <p className="text-zinc-600 text-xs">
                Limite de execuções diárias · hoje: <span className={ep.runs_per_day && ep.runs_today >= ep.runs_per_day ? 'text-orange-400 font-medium' : 'text-zinc-400'}>{ep.runs_today}</span>
                {ep.runs_per_day ? ` / ${ep.runs_per_day}` : ''}
              </p>
            </div>
          </div>

          {/* Active days */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Dias ativos</label>
            <div className="flex gap-1.5">
              {DAY_NUMBERS.map((d, i) => {
                const currentDays = draft.active_days ?? ep.active_days
                const isOn = currentDays.includes(d)
                return (
                  <button
                    key={d}
                    onClick={() => {
                      const current = draft.active_days ?? ep.active_days
                      const next = isOn ? current.filter(x => x !== d) : [...current, d].sort()
                      setDraft(dd => ({ ...dd, active_days: next }))
                    }}
                    className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                      isOn
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-zinc-700 text-zinc-600 hover:text-zinc-400'
                    }`}
                  >
                    {DAY_LABELS[i]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Stats row */}
          {ep.last_run_at && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="text-zinc-600">Último run: {new Date(ep.last_run_at).toLocaleString('pt-PT')}</span>
              <span className="text-zinc-500">Fetch: <span className="text-zinc-300">{ep.last_fetched}</span></span>
              <span className="text-zinc-500">Inserido: <span className="text-green-400">{ep.last_inserted}</span></span>
              <span className="text-zinc-500">Skip: <span className="text-zinc-400">{ep.last_skipped}</span></span>
              {ep.last_failed > 0 && <span className="text-zinc-500">Falhou: <span className="text-red-400">{ep.last_failed}</span></span>}
            </div>
          )}

          {/* Save / discard */}
          {hasDraft && (
            <div className="flex items-center gap-2 pt-2 border-t border-zinc-800">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 text-xs bg-brand hover:bg-brand-dark disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Guardar
              </button>
              <button
                onClick={() => setDraft({})}
                className="text-xs text-zinc-400 hover:text-white px-3 py-2 rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Descartar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Jobs History Table ───────────────────────────────────────────────────────

function JobsHistory({ pipelineId, refreshKey }: { pipelineId: string; refreshKey?: number }) {
  const [jobs, setJobs] = useState<PipelineJob[]>([])
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ data: PipelineJob[] }>(`/api/pipelines/${pipelineId}/jobs`)
      setJobs(res.data)
    } catch {
      setJobs([])
    } finally {
      setLoading(false)
    }
  }, [pipelineId])

  useEffect(() => { load() }, [load, refreshKey])

  // Auto-poll every 5s to keep history fresh while pipeline runs
  useEffect(() => {
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  const handleClear = async () => {
    if (!confirmClear) { setConfirmClear(true); return }
    setClearing(true)
    setConfirmClear(false)
    try {
      await api.delete(`/api/pipelines/${pipelineId}/jobs`)
      await load()
    } finally {
      setClearing(false)
    }
  }

  const statusChip = (s: PipelineJob['status']) => {
    const map = {
      running:   'bg-green-500/10 text-green-400',
      done:      'bg-zinc-800 text-zinc-400',
      error:     'bg-red-500/10 text-red-400',
      cancelled: 'bg-yellow-500/10 text-yellow-500',
    }
    const labels = { running: 'A correr', done: 'Feito', error: 'Erro', cancelled: 'Cancelado' }
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[s]}`}>
        {labels[s]}
      </span>
    )
  }

  const elapsed = (job: PipelineJob) => {
    if (job.duration_ms != null) return `${(job.duration_ms / 1000).toFixed(1)}s`
    if (job.status === 'running') return '…'
    return '—'
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="bg-zinc-800 rounded-lg p-2">
            <History className="w-5 h-5 text-brand" />
          </div>
          <div>
            <h4 className="text-white font-medium">Histórico de Jobs</h4>
            <p className="text-zinc-500 text-xs">Últimos 100 jobs executados neste pipeline</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 text-zinc-400 hover:text-white text-sm px-3 py-2 rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
          <button
            onClick={handleClear}
            disabled={clearing || jobs.length === 0}
            onBlur={() => setConfirmClear(false)}
            className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg transition-colors disabled:opacity-50 ${
              confirmClear
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'text-zinc-400 hover:text-red-400 hover:bg-zinc-800'
            }`}
          >
            {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {confirmClear ? 'Confirmar?' : 'Limpar'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-zinc-500 text-sm py-6">
          <Loader2 className="w-4 h-4 animate-spin" />A carregar histórico…
        </div>
      ) : jobs.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 border-dashed rounded-xl p-8 text-center">
          <History className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-500 text-sm">Nenhum job executado ainda.</p>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left text-zinc-500 text-xs font-medium px-4 py-3">Workspace</th>
                  <th className="text-left text-zinc-500 text-xs font-medium px-4 py-3">Credencial</th>
                  <th className="text-left text-zinc-500 text-xs font-medium px-4 py-3">Entidade</th>
                  <th className="text-left text-zinc-500 text-xs font-medium px-4 py-3">Estado</th>
                  <th className="text-right text-zinc-500 text-xs font-medium px-4 py-3">Fetch</th>
                  <th className="text-right text-zinc-500 text-xs font-medium px-4 py-3">Ins</th>
                  <th className="text-right text-zinc-500 text-xs font-medium px-4 py-3">Skip</th>
                  <th className="text-right text-zinc-500 text-xs font-medium px-4 py-3">Fail</th>
                  <th className="text-right text-zinc-500 text-xs font-medium px-4 py-3">Tempo</th>
                  <th className="text-left text-zinc-500 text-xs font-medium px-4 py-3">Início</th>
                  <th className="text-left text-zinc-500 text-xs font-medium px-4 py-3">Fim</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job, i) => (
                  <tr key={job.id} className={i < jobs.length - 1 ? 'border-b border-zinc-800/50' : ''}>
                    <td className="px-4 py-3 text-zinc-300 text-xs">{job.workspace_name ?? '—'}</td>
                    <td className="px-4 py-3 text-zinc-400 text-xs truncate max-w-[120px]">{job.credential_name ?? '—'}</td>
                    <td className="px-4 py-3 text-white text-xs font-medium">{job.entity}</td>
                    <td className="px-4 py-3">{statusChip(job.status)}</td>
                    <td className="px-4 py-3 text-zinc-400 text-xs text-right">{job.fetched}</td>
                    <td className="px-4 py-3 text-green-400 text-xs text-right">{job.inserted}</td>
                    <td className="px-4 py-3 text-zinc-500 text-xs text-right">{job.skipped}</td>
                    <td className="px-4 py-3 text-xs text-right">
                      {job.failed > 0 ? <span className="text-red-400">{job.failed}</span> : <span className="text-zinc-700">0</span>}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs text-right font-mono">{elapsed(job)}</td>
                    <td className="px-4 py-3 text-zinc-600 text-xs whitespace-nowrap">
                      {new Date(job.started_at).toLocaleString('pt-PT')}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 text-xs whitespace-nowrap">
                      {job.finished_at ? new Date(job.finished_at).toLocaleString('pt-PT') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

// ─── PipelineTab ──────────────────────────────────────────────────────────────

interface PipelineTabProps {
  pipelineId: string
  workerName: string
  workerUrl: string
  initialPipeline?: Pipeline | null
  onPipelineUpdated?: (p: Pipeline) => void
}

export default function PipelineTab({
  pipelineId,
  workerName,
  workerUrl,
  initialPipeline,
  onPipelineUpdated,
}: PipelineTabProps) {
  const [pipeline, setPipeline] = useState<Pipeline | null>(initialPipeline ?? null)
  const [endpoints, setEndpoints] = useState<PipelineEndpoint[]>([])
  const [loadingEp, setLoadingEp] = useState(true)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [jobsKey, setJobsKey] = useState(0)

  // settings edit
  const [intervalMin, setIntervalMin] = useState<number>(pipeline?.interval_min ?? 5)
  const [intervalMax, setIntervalMax] = useState<number>(pipeline?.interval_max ?? 15)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsMsg, setSettingsMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // pipeline control
  const [controlling, setControlling] = useState(false)

  // drag-and-drop
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const dragOverId = useRef<string | null>(null)

  // stable ref to onPipelineUpdated — avoids re-creating loadPipeline on every parent render
  const onPipelineUpdatedRef = useRef(onPipelineUpdated)
  useEffect(() => { onPipelineUpdatedRef.current = onPipelineUpdated }, [onPipelineUpdated])

  // load pipeline if not provided
  const loadPipeline = useCallback(async () => {
    try {
      const res = await api.get<{ data: Pipeline[] }>('/api/pipelines')
      const p = res.data.find(x => x.id === pipelineId) ?? null
      if (p) {
        setPipeline(p)
        setIntervalMin(p.interval_min)
        setIntervalMax(p.interval_max)
        onPipelineUpdatedRef.current?.(p)
      }
    } catch { /* ignore */ }
  }, [pipelineId])

  const loadEndpoints = useCallback(async () => {
    setLoadingEp(true)
    try {
      const res = await api.get<{ data: PipelineEndpoint[] }>(`/api/pipelines/${pipelineId}/endpoints`)
      setEndpoints(res.data)
    } catch {
      setEndpoints([])
    } finally {
      setLoadingEp(false)
    }
  }, [pipelineId])

  const loadWorkspaces = useCallback(async () => {
    try {
      const res = await api.get<{ data: Workspace[] }>('/api/connections/workspaces')
      setWorkspaces(res.data)
    } catch {
      setWorkspaces([])
    }
  }, [])

  const loadCredentials = useCallback(async () => {
    try {
      const res = await api.get<{ data: Credential[] }>('/api/credentials')
      setCredentials(res.data.filter(c => c.is_active))
    } catch {
      setCredentials([])
    }
  }, [])

  useEffect(() => {
    loadPipeline()
    loadEndpoints()
    loadWorkspaces()
    loadCredentials()
  }, [loadPipeline, loadEndpoints, loadWorkspaces, loadCredentials])

  // ── Settings save ──────────────────────────────────────────────────────────
  const handleSaveSettings = async () => {
    if (intervalMin < 1 || intervalMax < intervalMin) {
      setSettingsMsg({ ok: false, text: 'Intervalo inválido: min deve ser ≥ 1 e max ≥ min.' })
      return
    }
    setSavingSettings(true)
    setSettingsMsg(null)
    try {
      const res = await api.patch<Pipeline>(`/api/pipelines/${pipelineId}`, {
        interval_min: intervalMin,
        interval_max: intervalMax,
        status: pipeline?.status === 'not_configured' ? 'ready' : pipeline?.status,
      })
      setPipeline(res)
      onPipelineUpdated?.(res)
      setSettingsMsg({ ok: true, text: 'Configurações guardadas.' })
    } catch (err: unknown) {
      setSettingsMsg({ ok: false, text: err instanceof Error ? err.message : 'Erro ao guardar.' })
    } finally {
      setSavingSettings(false)
    }
  }

  // ── Pipeline control ───────────────────────────────────────────────────────
  const handleStartStop = async () => {
    if (!pipeline) return
    const isRunning = pipeline.status === 'running'
    setControlling(true)
    try {
      const res = await api.patch<Pipeline>(`/api/pipelines/${pipelineId}`, {
        status: isRunning ? 'stopped' : 'running',
        ...(isRunning ? { stopped_at: new Date().toISOString() } : { started_at: new Date().toISOString() }),
      })
      setPipeline(res)
      onPipelineUpdated?.(res)
    } finally {
      setControlling(false)
    }
  }

  // ── Endpoint save ──────────────────────────────────────────────────────────
  const handleSaveEndpoint = async (id: string, data: Partial<PipelineEndpoint>) => {
    await api.patch(`/api/pipelines/${pipelineId}/endpoints/${id}`, data)
    await loadEndpoints()
  }

  const handleToggleEndpoint = async (id: string, is_active: boolean) => {
    await api.patch(`/api/pipelines/${pipelineId}/endpoints/${id}`, { is_active })
    await loadEndpoints()
  }

  const handleManualBackfill = async (id: string) => {
    await api.post(`/api/pipelines/${pipelineId}/endpoints/${id}/backfill`, { force_full: true })
    await loadEndpoints()
    setJobsKey((k: number) => k + 1)
  }

  // ── Drag-and-drop ──────────────────────────────────────────────────────────
  const handleDragStart = (id: string) => setDraggingId(id)
  const handleDragOver  = (id: string) => { dragOverId.current = id }

  const handleDragEnd = async () => {
    const fromId = draggingId
    const toId   = dragOverId.current
    setDraggingId(null)
    dragOverId.current = null

    if (!fromId || !toId || fromId === toId) return

    const from = endpoints.findIndex(e => e.id === fromId)
    const to   = endpoints.findIndex(e => e.id === toId)
    if (from === -1 || to === -1) return

    const reordered = [...endpoints]
    const [moved]   = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    setEndpoints(reordered)

    try {
      await api.put(`/api/pipelines/${pipelineId}/endpoints/reorder`, {
        order: reordered.map(e => e.id),
      })
    } catch {
      await loadEndpoints()
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const isRunning    = pipeline?.status === 'running'
  const canStart     = pipeline?.status === 'ready' || pipeline?.status === 'stopped'
  const statusCfg    = pipeline ? STATUS_CONFIG[pipeline.status] : STATUS_CONFIG.not_configured

  return (
    <div className="space-y-8">
      {/* ── Section 1: Configurações ─────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="bg-zinc-800 rounded-lg p-2">
            <Settings className="w-5 h-5 text-brand" />
          </div>
          <div>
            <h4 className="text-white font-medium">Configurações do Pipeline</h4>
            <p className="text-zinc-500 text-xs">Worker: <span className="text-zinc-400 font-mono">{workerUrl}</span></p>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-5">
          {/* Status + control */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <span className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full ${statusCfg.bg} ${statusCfg.color}`}>
                {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
                {statusCfg.label}
              </span>
              {pipeline?.started_at && (
                <span className="text-zinc-600 text-xs">
                  Iniciado: {new Date(pipeline.started_at).toLocaleString('pt-PT')}
                </span>
              )}
            </div>

            <button
              onClick={handleStartStop}
              disabled={controlling || (!isRunning && !canStart)}
              title={!isRunning && !canStart ? 'Guarda as configurações primeiro' : undefined}
              className={`flex items-center gap-2 text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                isRunning
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-green-700 hover:bg-green-600 text-white'
              }`}
            >
              {controlling
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : isRunning
                  ? <Square className="w-4 h-4" />
                  : <Play className="w-4 h-4" />}
              {isRunning ? 'Parar Pipeline' : 'Iniciar Pipeline'}
            </button>
          </div>

          {/* Interval config */}
          <div className="grid grid-cols-2 gap-4 pt-3 border-t border-zinc-800">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">
                Intervalo mínimo entre endpoints (segundos)
              </label>
              <input
                type="number" min={1} max={3600}
                value={intervalMin}
                onChange={e => setIntervalMin(Number(e.target.value))}
                className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">
                Intervalo máximo entre endpoints (segundos)
              </label>
              <input
                type="number" min={1} max={3600}
                value={intervalMax}
                onChange={e => setIntervalMax(Number(e.target.value))}
                className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand"
              />
            </div>
          </div>

          <p className="text-zinc-600 text-xs">
            O pipeline aguarda um tempo aleatório entre <span className="text-zinc-400">{intervalMin}s</span> e{' '}
            <span className="text-zinc-400">{intervalMax}s</span> entre cada endpoint para evitar bloqueios no 21online.app.
          </p>

          {settingsMsg && (
            <div className={`flex items-center gap-2 text-sm px-3 py-2.5 rounded-lg ${
              settingsMsg.ok
                ? 'bg-green-950/50 border border-green-800/60 text-green-300'
                : 'bg-red-950/50 border border-red-800/60 text-red-300'
            }`}>
              {settingsMsg.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              {settingsMsg.text}
            </div>
          )}

          <div className="flex items-center gap-3 pt-1 border-t border-zinc-800">
            <button
              onClick={handleSaveSettings}
              disabled={savingSettings}
              className="flex items-center gap-2 bg-brand hover:bg-brand-dark disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Guardar configurações
            </button>
          </div>
        </div>
      </section>

      {/* ── Section 2: EndPoints ─────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="bg-zinc-800 rounded-lg p-2">
              <Database className="w-5 h-5 text-brand" />
            </div>
            <div>
              <h4 className="text-white font-medium">EndPoints</h4>
              <p className="text-zinc-500 text-xs">
                Arrasta para reordenar · apenas 1 endpoint executa de cada vez
              </p>
            </div>
          </div>
          <button
            onClick={loadEndpoints}
            disabled={loadingEp}
            className="flex items-center gap-2 text-zinc-400 hover:text-white text-sm px-3 py-2 rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loadingEp ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>

        {loadingEp ? (
          <div className="flex items-center gap-2 text-zinc-500 text-sm py-6">
            <Loader2 className="w-4 h-4 animate-spin" />A carregar endpoints…
          </div>
        ) : endpoints.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 border-dashed rounded-xl p-8 text-center">
            <Zap className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">Nenhum endpoint configurado.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {endpoints.map((ep, i) => (
              <EndpointCard
                key={ep.id}
                ep={ep}
                index={i}
                isRunning={isRunning}
                workspaces={workspaces}
                credentials={credentials}
                onSave={handleSaveEndpoint}
                onToggle={handleToggleEndpoint}
                onManualBackfill={handleManualBackfill}
                draggingId={draggingId}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Section 3: Jobs History ──────────────────────────────────────── */}
      <JobsHistory pipelineId={pipelineId} refreshKey={jobsKey} />
    </div>
  )
}
