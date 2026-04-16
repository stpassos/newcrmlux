import { useState, useEffect, useCallback, type ReactNode, type FormEvent } from 'react'
import { api } from '@/lib/api'
import {
  FolderSync, Plus, Trash2, Eye, EyeOff,
  CheckCircle2, XCircle, Loader2, RefreshCw, Wifi, WifiOff,
  Building2, Server, Activity, GitBranch, Search, ChevronRight,
  KeyRound, FlaskConical, Save, Ban, Pencil, Zap, X
} from 'lucide-react'
import PipelineTab, { type Pipeline } from '@/components/PipelineTab'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CrmConnection {
  id: string
  email: string
  base_url: string
  workspace_id: string | null
  workspace_name: string | null
  is_active: boolean
  has_session: boolean
  last_sync_at: string | null
  created_at: string
}

interface Workspace {
  id?: string
  name?: string
  slug?: string
  type?: string
  [key: string]: unknown
}

interface WorkerStatus {
  name: string
  url: string
  status: 'online' | 'offline' | 'error'
  http_status: number | null
  response_time_ms: number
  service: string | null
  checked_at: string
  error?: string
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Credential {
  id: string
  name: string
  email: string
  is_active: boolean
  last_tested_at: string | null
  test_status: 'success' | 'error' | null
  test_error: string | null
  created_at: string
  updated_at: string
}

interface PipelineTabInfo {
  tabId: string        // e.g. 'pipeline_WorkerLux-1'
  pipelineId: string
  workerName: string
  workerUrl: string
  label: string        // e.g. 'Pipeline WorkerLux-1'
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

type Tab = string   // 'sync' | 'workers' | 'endpoints' | 'credentials' | 'pipeline_<name>'

interface TabBarProps {
  active: Tab
  onChange: (t: Tab) => void
  pipelineTabs: PipelineTabInfo[]
  onClosePipelineTab: (tabId: string) => void
}

function TabBar({ active, onChange, pipelineTabs, onClosePipelineTab }: TabBarProps) {
  const staticTabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'sync',        label: 'Sincronização', icon: <FolderSync className="w-4 h-4" /> },
    { id: 'workers',     label: 'Workers',       icon: <Server className="w-4 h-4" /> },
    { id: 'endpoints',   label: 'EndPoints',     icon: <GitBranch className="w-4 h-4" /> },
    { id: 'credentials', label: 'Credenciais',   icon: <KeyRound className="w-4 h-4" /> },
  ]
  return (
    <div className="flex gap-1 border-b border-zinc-800 mb-8 flex-wrap">
      {staticTabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
            active === t.id
              ? 'border-brand text-white'
              : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
      {pipelineTabs.map(pt => (
        <div key={pt.tabId} className={`flex items-center border-b-2 -mb-px transition-colors ${
          active === pt.tabId ? 'border-brand' : 'border-transparent'
        }`}>
          <button
            onClick={() => onChange(pt.tabId)}
            className={`flex items-center gap-2 pl-4 pr-2 py-3 text-sm font-medium transition-colors ${
              active === pt.tabId ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Zap className="w-4 h-4" />
            {pt.label}
          </button>
          <button
            onClick={e => { e.stopPropagation(); onClosePipelineTab(pt.tabId) }}
            className="pr-3 py-3 text-zinc-600 hover:text-zinc-300 transition-colors"
            title="Fechar tab"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

// ─── Workers tab ──────────────────────────────────────────────────────────────

interface WorkersTabProps {
  pipelines: Pipeline[]
  onActivatePipeline: (worker: WorkerStatus) => Promise<void>
  onDeactivatePipeline: (pipelineId: string) => Promise<void>
}

interface PipelineBtnProps {
  workerName: string
  pipeline: Pipeline | undefined
  busy: boolean
  onActivate: () => void
  onDeactivate: () => void
}

function PipelineBtn({ workerName: _n, pipeline, busy, onActivate, onDeactivate }: PipelineBtnProps) {
  const isActive = pipeline?.is_active ?? false
  if (isActive) {
    return (
      <button
        disabled={busy}
        onClick={onDeactivate}
        className="flex items-center gap-1.5 text-xs border border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-800/60 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
        Desativar Pipeline
      </button>
    )
  }
  return (
    <button
      disabled={busy}
      onClick={onActivate}
      className="flex items-center gap-1.5 text-xs border border-zinc-700 text-zinc-400 hover:text-brand hover:border-brand/50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
      Ativar Pipeline
    </button>
  )
}

function WorkersTab({ pipelines, onActivatePipeline, onDeactivatePipeline }: WorkersTabProps) {
  const [workers, setWorkers] = useState<WorkerStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [pipelineOp, setPipelineOp] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<{ data: WorkerStatus[] }>('/api/workers/status')
      setWorkers(res.data)
      setLastRefresh(new Date())
    } catch {
      setWorkers([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const statusColor = (s: WorkerStatus['status']) =>
    s === 'online' ? 'text-green-400' : 'text-red-400'

  const statusBg = (s: WorkerStatus['status']) =>
    s === 'online' ? 'bg-green-500/10' : 'bg-red-500/10'

  const statusLabel = (s: WorkerStatus['status']) =>
    s === 'online' ? 'Online' : s === 'offline' ? 'Offline' : 'Erro'

  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-zinc-800 rounded-lg p-2">
            <Server className="w-5 h-5 text-brand" />
          </div>
          <div>
            <h3 className="text-white font-medium">Workers</h3>
            <p className="text-zinc-500 text-xs">
              Estado dos workers de sincronização com o 21online.app
              {lastRefresh && (
                <span className="ml-2 text-zinc-600">
                  · atualizado às {lastRefresh.toLocaleTimeString('pt-PT')}
                </span>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 text-zinc-400 hover:text-white text-sm px-3 py-2 rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {loading && workers.length === 0 ? (
        <div className="flex items-center gap-2 text-zinc-500 text-sm py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          A verificar workers...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {workers.map(w => (
            <div
              key={w.name}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-5"
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${statusBg(w.status)}`}>
                    <Activity className={`w-4 h-4 ${statusColor(w.status)}`} />
                  </div>
                  <div>
                    <p className="text-white font-medium text-sm">{w.name}</p>
                    <p className="text-zinc-600 text-xs font-mono">{w.url}</p>
                  </div>
                </div>
                <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
                  w.status === 'online'
                    ? 'bg-green-500/10 text-green-400'
                    : 'bg-red-500/10 text-red-400'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    w.status === 'online' ? 'bg-green-400' : 'bg-red-400'
                  } ${w.status === 'online' ? 'animate-pulse' : ''}`} />
                  {statusLabel(w.status)}
                </span>
              </div>

              {/* Metrics */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-zinc-800/50 rounded-lg px-3 py-2.5">
                  <p className="text-zinc-500 text-xs mb-0.5">Tempo de resposta</p>
                  <p className={`text-sm font-semibold ${
                    w.status === 'online'
                      ? w.response_time_ms < 500 ? 'text-green-400' : w.response_time_ms < 2000 ? 'text-yellow-400' : 'text-red-400'
                      : 'text-zinc-500'
                  }`}>
                    {w.status === 'online' ? `${w.response_time_ms} ms` : '—'}
                  </p>
                </div>
                <div className="bg-zinc-800/50 rounded-lg px-3 py-2.5">
                  <p className="text-zinc-500 text-xs mb-0.5">Serviço</p>
                  <p className="text-white text-sm font-medium truncate">
                    {w.service || '—'}
                  </p>
                </div>
              </div>

              {/* Error */}
              {w.error && (
                <div className="mt-3 flex items-start gap-2 bg-red-950/30 border border-red-800/30 rounded-lg px-3 py-2">
                  <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-red-400 text-xs break-all">{w.error}</p>
                </div>
              )}

              {/* Footer */}
              <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-zinc-600 text-xs">HTTP {w.http_status ?? '—'}</span>
                  <span className="text-zinc-600 text-xs">{new Date(w.checked_at).toLocaleTimeString('pt-PT')}</span>
                </div>
                <PipelineBtn
                  workerName={w.name}
                  pipeline={pipelines.find(p => p.worker_name === w.name)}
                  busy={pipelineOp[w.name] ?? false}
                  onActivate={async () => {
                    setPipelineOp((prev: Record<string, boolean>) => ({ ...prev, [w.name]: true }))
                    try { await onActivatePipeline(w) }
                    finally { setPipelineOp((prev: Record<string, boolean>) => ({ ...prev, [w.name]: false })) }
                  }}
                  onDeactivate={async () => {
                    const pl = pipelines.find(p => p.worker_name === w.name)
                    if (!pl) return
                    setPipelineOp((prev: Record<string, boolean>) => ({ ...prev, [w.name]: true }))
                    try { await onDeactivatePipeline(pl.id) }
                    finally { setPipelineOp((prev: Record<string, boolean>) => ({ ...prev, [w.name]: false })) }
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Sync tab ─────────────────────────────────────────────────────────────────

function SyncTab() {
  const [activeConn, setActiveConn] = useState<CrmConnection | null>(null)
  const [connLoading, setConnLoading] = useState(true)

  const [credentials, setCredentials] = useState<Credential[]>([])
  const [selectedCredId, setSelectedCredId] = useState('')
  const [activating, setActivating] = useState(false)
  const [activateError, setActivateError] = useState<string | null>(null)
  const [activateSuccess, setActivateSuccess] = useState(false)

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspacesLoading, setWorkspacesLoading] = useState(false)
  const [workspacesError, setWorkspacesError] = useState<string | null>(null)

  const loadActiveConn = useCallback(async () => {
    setConnLoading(true)
    try {
      const res = await api.get<{ data: CrmConnection[] }>('/api/connections')
      const active = res.data.find(c => c.is_active) ?? null
      setActiveConn(active)
      return active
    } catch {
      return null
    } finally {
      setConnLoading(false)
    }
  }, [])

  const loadCredentials = useCallback(async () => {
    try {
      const res = await api.get<{ data: Credential[] }>('/api/credentials')
      const active = res.data.filter(c => c.is_active)
      setCredentials(active)
    } catch {
      setCredentials([])
    }
  }, [])

  const loadWorkspaces = useCallback(async () => {
    setWorkspacesLoading(true)
    setWorkspacesError(null)
    try {
      const res = await api.get<{ data: Workspace[]; connection_email: string }>('/api/connections/workspaces')
      setWorkspaces(res.data)
    } catch (err: unknown) {
      setWorkspacesError(err instanceof Error ? err.message : 'Erro ao carregar workspaces.')
      setWorkspaces([])
    } finally {
      setWorkspacesLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCredentials()
    loadActiveConn().then((conn: CrmConnection | null) => { if (conn) loadWorkspaces() })
  }, [loadCredentials, loadActiveConn, loadWorkspaces])

  const handleActivate = async () => {
    if (!selectedCredId) return
    setActivating(true)
    setActivateError(null)
    setActivateSuccess(false)
    try {
      await api.post('/api/connections/activate', { credential_id: selectedCredId })
      setActivateSuccess(true)
      setSelectedCredId('')
      const conn = await loadActiveConn()
      if (conn) loadWorkspaces()
    } catch (err: unknown) {
      setActivateError(err instanceof Error ? err.message : 'Erro ao ativar credencial.')
    } finally {
      setActivating(false)
    }
  }

  return (
    <>
      {/* Conexão ativa */}
      <section className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="bg-zinc-800 rounded-lg p-2">
            <FolderSync className="w-5 h-5 text-brand" />
          </div>
          <div>
            <h3 className="text-white font-medium">Conexão ativa</h3>
            <p className="text-zinc-500 text-xs">Credencial utilizada para sincronizar dados com o 21online.app</p>
          </div>
        </div>

        {/* Selector */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-4">
          <p className="text-zinc-400 text-xs font-medium mb-3">Selecionar credencial</p>
          <div className="flex gap-3">
            <select
              value={selectedCredId}
              onChange={e => { setSelectedCredId(e.target.value); setActivateError(null); setActivateSuccess(false) }}
              className="flex-1 bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-colors appearance-none cursor-pointer"
            >
              <option value="">— Escolhe uma credencial ativa —</option>
              {credentials.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}  ·  {c.email}
                </option>
              ))}
            </select>
            <button
              onClick={handleActivate}
              disabled={!selectedCredId || activating}
              className="flex items-center gap-2 bg-brand hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors shrink-0"
            >
              {activating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
              Ativar
            </button>
          </div>

          {credentials.length === 0 && (
            <p className="text-zinc-600 text-xs mt-2">
              Nenhuma credencial ativa disponível — adiciona uma na tab <span className="text-zinc-400">Credenciais</span>.
            </p>
          )}

          {activateError && (
            <div className="flex items-center gap-2 mt-3 text-sm px-3 py-2.5 rounded-lg bg-red-950/50 border border-red-800/60 text-red-300">
              <XCircle className="w-4 h-4 shrink-0" />{activateError}
            </div>
          )}
          {activateSuccess && (
            <div className="flex items-center gap-2 mt-3 text-sm px-3 py-2.5 rounded-lg bg-green-950/50 border border-green-800/60 text-green-300">
              <CheckCircle2 className="w-4 h-4 shrink-0" />Conexão ativada com sucesso.
            </div>
          )}
        </div>

        {/* Active connection status */}
        {connLoading ? (
          <div className="flex items-center gap-2 text-zinc-500 text-sm py-3">
            <Loader2 className="w-4 h-4 animate-spin" />A carregar...
          </div>
        ) : activeConn ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 flex items-center gap-3">
            <div className="p-1.5 rounded-full bg-green-500/10 shrink-0">
              <Wifi className="w-4 h-4 text-green-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white text-sm font-medium truncate">{activeConn.email}</p>
              <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                <span className="text-xs font-medium text-green-400">Ativa</span>
                {activeConn.has_session && (
                  <span className="text-xs text-zinc-500 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-green-500" />Sessão válida
                  </span>
                )}
                {activeConn.last_sync_at && (
                  <span className="text-xs text-zinc-600">
                    Último sync: {new Date(activeConn.last_sync_at).toLocaleDateString('pt-PT')}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 border-dashed rounded-xl p-6 text-center">
            <WifiOff className="w-7 h-7 text-zinc-700 mx-auto mb-2" />
            <p className="text-zinc-500 text-sm">Nenhuma conexão ativa.</p>
          </div>
        )}
      </section>

      {/* Workspaces */}
      {!!activeConn && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="bg-zinc-800 rounded-lg p-2">
                <Building2 className="w-5 h-5 text-brand" />
              </div>
              <div>
                <h3 className="text-white font-medium">Workspaces</h3>
                <p className="text-zinc-500 text-xs">Workspaces disponíveis na conta 21online.app</p>
              </div>
            </div>
            <button onClick={loadWorkspaces} disabled={workspacesLoading}
              className="flex items-center gap-2 text-zinc-400 hover:text-white text-sm px-3 py-2 rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${workspacesLoading ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
          </div>

          {workspacesLoading ? (
            <div className="flex items-center gap-2 text-zinc-500 text-sm py-4">
              <Loader2 className="w-4 h-4 animate-spin" />A carregar workspaces...
            </div>
          ) : workspacesError ? (
            <div className="bg-red-950/30 border border-red-800/40 rounded-xl px-5 py-4 flex items-center gap-3">
              <XCircle className="w-5 h-5 text-red-400 shrink-0" />
              <p className="text-red-300 text-sm">{workspacesError}</p>
            </div>
          ) : workspaces.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 border-dashed rounded-xl p-8 text-center">
              <Building2 className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
              <p className="text-zinc-500 text-sm">Nenhum workspace encontrado.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {workspaces.map((ws, i) => {
                const wsId = ws.id ?? ws.external_id ?? String(i)
                const wsName = ws.name ?? ws.slug ?? `Workspace ${i + 1}`
                const wsType = ws.type as string | undefined
                return (
                  <div key={String(wsId)} className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 flex items-center gap-3">
                    <div className="bg-brand/10 rounded-lg p-2 shrink-0">
                      <Building2 className="w-4 h-4 text-brand" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-white text-sm font-medium truncate">{String(wsName)}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {wsType && <span className="text-xs text-zinc-500 capitalize">{String(wsType)}</span>}
                        {ws.id && <span className="text-xs text-zinc-700 font-mono truncate">{String(ws.id).slice(0, 8)}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {/* Histórico */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-white font-medium">Histórico de sincronizações</h3>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 border-dashed rounded-xl p-6 text-center">
          <p className="text-zinc-500 text-sm">O histórico de sincronizações será apresentado aqui.</p>
        </div>
      </section>
    </>
  )
}

// ─── EndPoints tab ────────────────────────────────────────────────────────────

interface EndpointField {
  path: string
  type: string
  sample: string | null
}

interface MapResult {
  endpoint: string
  fields: EndpointField[]
  total: number
  sample_count: number
}

const TYPE_COLOR: Record<string, string> = {
  string:  'text-green-400 bg-green-500/10',
  number:  'text-blue-400 bg-blue-500/10',
  boolean: 'text-yellow-400 bg-yellow-500/10',
  object:  'text-purple-400 bg-purple-500/10',
  array:   'text-orange-400 bg-orange-500/10',
  null:    'text-zinc-500 bg-zinc-800',
}

function EndPointsTab() {
  const [endpoint, setEndpoint] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<MapResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleMap = async (e: FormEvent) => {
    e.preventDefault()
    if (!endpoint.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await api.post<MapResult>('/api/endpoints/map', { endpoint: endpoint.trim() })
      setResult(res)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao mapear endpoint.')
    } finally {
      setLoading(false)
    }
  }

  const topLevel = result?.fields.filter((f: EndpointField) => !f.path.includes('.')) ?? []
  const nested   = result?.fields.filter((f: EndpointField) =>  f.path.includes('.')) ?? []

  return (
    <section>
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-zinc-800 rounded-lg p-2">
          <GitBranch className="w-5 h-5 text-brand" />
        </div>
        <div>
          <h3 className="text-white font-medium">EndPoints</h3>
          <p className="text-zinc-500 text-xs">Mapeia os campos disponíveis num endpoint do 21online.app via WorkerLux-1</p>
        </div>
      </div>

      {/* Input */}
      <form onSubmit={handleMap} className="flex gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            value={endpoint}
            onChange={e => setEndpoint(e.target.value)}
            placeholder="/api/leads   ou   /api/assets   ou   /api/users"
            className="w-full bg-zinc-900 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg pl-10 pr-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-colors"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !endpoint.trim()}
          className="flex items-center gap-2 bg-brand hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitBranch className="w-4 h-4" />}
          Mapear
        </button>
      </form>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 bg-red-950/40 border border-red-800/50 text-red-300 text-sm px-4 py-3 rounded-lg mb-4">
          <XCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-zinc-500 text-sm py-6">
          <Loader2 className="w-4 h-4 animate-spin" />A mapear campos via WorkerLux-1…
        </div>
      )}

      {/* Results */}
      {result && (
        <div>
          {/* Summary */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2">
              <span className="text-zinc-500 text-xs">Endpoint</span>
              <span className="text-brand text-sm font-mono">{result.endpoint}</span>
            </div>
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2">
              <span className="text-zinc-500 text-xs">Campos</span>
              <span className="text-white text-sm font-semibold">{result.fields.length}</span>
            </div>
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2">
              <span className="text-zinc-500 text-xs">Registos obtidos</span>
              <span className="text-white text-sm font-semibold">{result.total}</span>
            </div>
          </div>

          {result.fields.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 border-dashed rounded-xl p-8 text-center">
              <p className="text-zinc-500 text-sm">Nenhum campo encontrado neste endpoint.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Top-level fields */}
              <div>
                <p className="text-zinc-400 text-xs font-medium uppercase tracking-wider mb-3">
                  Campos raiz ({topLevel.length})
                </p>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800">
                        <th className="text-left text-zinc-500 text-xs font-medium px-4 py-3 w-1/3">Campo</th>
                        <th className="text-left text-zinc-500 text-xs font-medium px-4 py-3 w-24">Tipo</th>
                        <th className="text-left text-zinc-500 text-xs font-medium px-4 py-3">Exemplo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topLevel.map((f, i) => (
                        <tr key={f.path} className={i < topLevel.length - 1 ? 'border-b border-zinc-800/50' : ''}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <ChevronRight className="w-3 h-3 text-zinc-600 shrink-0" />
                              <span className="text-white font-mono text-xs">{f.path}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLOR[f.type] ?? 'text-zinc-400 bg-zinc-800'}`}>
                              {f.type}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-zinc-400 text-xs font-mono truncate block max-w-xs">
                              {f.sample ?? <span className="text-zinc-600 italic">object</span>}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Nested fields */}
              {nested.length > 0 && (
                <div>
                  <p className="text-zinc-400 text-xs font-medium uppercase tracking-wider mb-3">
                    Campos aninhados ({nested.length})
                  </p>
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-zinc-800">
                          <th className="text-left text-zinc-500 text-xs font-medium px-4 py-3 w-1/3">Caminho</th>
                          <th className="text-left text-zinc-500 text-xs font-medium px-4 py-3 w-24">Tipo</th>
                          <th className="text-left text-zinc-500 text-xs font-medium px-4 py-3">Exemplo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nested.map((f, i) => (
                          <tr key={f.path} className={i < nested.length - 1 ? 'border-b border-zinc-800/50' : ''}>
                            <td className="px-4 py-3">
                              <span className="text-zinc-400 font-mono text-xs">{f.path}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLOR[f.type] ?? 'text-zinc-400 bg-zinc-800'}`}>
                                {f.type}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-zinc-400 text-xs font-mono truncate block max-w-xs">
                                {f.sample ?? <span className="text-zinc-600 italic">object</span>}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ─── Credenciais tab ──────────────────────────────────────────────────────────

interface CredentialFormState {
  name: string
  email: string
  password: string
  showPassword: boolean
}

const EMPTY_FORM: CredentialFormState = { name: '', email: '', password: '', showPassword: false }

function CredenciaisTab() {
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState<CredentialFormState>(EMPTY_FORM)
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // per-card state: editing, testing, saving
  const [editing, setEditing] = useState<Record<string, CredentialFormState>>({})
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ data: Credential[] }>('/api/credentials')
      setCredentials(res.data)
    } catch {
      setCredentials([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Add new ──────────────────────────────────────────────
  const handleAdd = async (e: FormEvent) => {
    e.preventDefault()
    setAddError(null)
    setAddSaving(true)
    try {
      await api.post('/api/credentials', {
        name: addForm.name,
        email: addForm.email,
        password: addForm.password,
      })
      setShowAddForm(false)
      setAddForm(EMPTY_FORM)
      await load()
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : 'Erro ao guardar credencial.')
    } finally {
      setAddSaving(false)
    }
  }

  // ── Test connection ───────────────────────────────────────
  const handleTest = async (id: string) => {
    setTesting(prev => ({ ...prev, [id]: true }))
    try {
      await api.post(`/api/credentials/${id}/test`, {})
      await load()
    } finally {
      setTesting(prev => ({ ...prev, [id]: false }))
    }
  }

  // ── Save edit ─────────────────────────────────────────────
  const handleSaveEdit = async (id: string) => {
    const f = editing[id]
    if (!f) return
    setSaving(prev => ({ ...prev, [id]: true }))
    try {
      const body: Record<string, string> = { name: f.name, email: f.email }
      if (f.password) body.password = f.password
      await api.patch(`/api/credentials/${id}`, body)
      setEditing(prev => { const n = { ...prev }; delete n[id]; return n })
      await load()
    } finally {
      setSaving(prev => ({ ...prev, [id]: false }))
    }
  }

  // ── Toggle active ─────────────────────────────────────────
  const handleToggle = async (cred: Credential) => {
    try {
      await api.patch(`/api/credentials/${cred.id}`, { is_active: !cred.is_active })
      await load()
    } catch { /* ignore */ }
  }

  // ── Delete ────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!confirm('Remover esta credencial?')) return
    try {
      await api.delete(`/api/credentials/${id}`)
      await load()
    } catch { /* ignore */ }
  }

  const startEdit = (cred: Credential) =>
    setEditing(prev => ({
      ...prev,
      [cred.id]: { name: cred.name, email: cred.email, password: '', showPassword: false },
    }))

  const cancelEdit = (id: string) =>
    setEditing(prev => { const n = { ...prev }; delete n[id]; return n })

  return (
    <section>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-zinc-800 rounded-lg p-2">
            <KeyRound className="w-5 h-5 text-brand" />
          </div>
          <div>
            <h3 className="text-white font-medium">Credenciais 21online.app</h3>
            <p className="text-zinc-500 text-xs">
              Contas utilizadas pelos WorkersLux para importação de dados
            </p>
          </div>
        </div>
        {!showAddForm && (
          <button
            onClick={() => { setShowAddForm(true); setAddError(null); setAddForm(EMPTY_FORM) }}
            className="flex items-center gap-2 bg-brand hover:bg-brand-dark text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Adicionar Credencial
          </button>
        )}
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 mb-6">
          <h4 className="text-white text-sm font-semibold mb-4">Nova credencial</h4>
          <form onSubmit={handleAdd} className="space-y-4">
            {addError && (
              <div className="flex items-center gap-2 text-sm px-4 py-3 rounded-lg bg-red-950/50 border border-red-800/60 text-red-300">
                <XCircle className="w-4 h-4 shrink-0" />{addError}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400">Nome</label>
                <input
                  type="text" value={addForm.name} required
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="ex: Conta Principal"
                  className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400">Email 21online.app</label>
                <input
                  type="email" value={addForm.email} required
                  onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="email@exemplo.com"
                  className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400">Password 21online.app</label>
                <div className="relative">
                  <input
                    type={addForm.showPassword ? 'text' : 'password'} value={addForm.password} required
                    onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="••••••••"
                    className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-colors"
                  />
                  <button type="button" tabIndex={-1}
                    onClick={() => setAddForm(f => ({ ...f, showPassword: !f.showPassword }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                    {addForm.showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button type="submit" disabled={addSaving}
                className="flex items-center gap-2 bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors">
                {addSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Guardar
              </button>
              <button type="button" onClick={() => { setShowAddForm(false); setAddError(null) }}
                className="text-zinc-400 hover:text-white text-sm px-4 py-2.5 rounded-lg hover:bg-zinc-800 transition-colors">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center gap-2 text-zinc-500 text-sm py-4">
          <Loader2 className="w-4 h-4 animate-spin" />A carregar credenciais...
        </div>
      ) : credentials.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 border-dashed rounded-xl p-10 text-center">
          <KeyRound className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-500 text-sm">Nenhuma credencial configurada.</p>
          <p className="text-zinc-600 text-xs mt-1">Adiciona uma conta 21online.app para os WorkersLux poderem importar dados.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {credentials.map(cred => {
            const isEditing = !!editing[cred.id]
            const ef = editing[cred.id]
            const isTesting = testing[cred.id] ?? false
            const isSaving = saving[cred.id] ?? false

            return (
              <div key={cred.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                {/* Card header */}
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-1.5 rounded-full shrink-0 ${cred.is_active ? 'bg-green-500/10' : 'bg-zinc-800'}`}>
                      {cred.is_active
                        ? <Wifi className="w-4 h-4 text-green-400" />
                        : <WifiOff className="w-4 h-4 text-zinc-500" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-white font-medium text-sm truncate">{cred.name}</p>
                      <p className="text-zinc-500 text-xs truncate">{cred.email}</p>
                    </div>
                  </div>

                  {/* Status badge */}
                  <div className="flex items-center gap-2 shrink-0">
                    {cred.test_status === 'success' && (
                      <span className="flex items-center gap-1 text-xs bg-green-500/10 text-green-400 px-2.5 py-1 rounded-full">
                        <CheckCircle2 className="w-3 h-3" />Validada
                      </span>
                    )}
                    {cred.test_status === 'error' && (
                      <span className="flex items-center gap-1 text-xs bg-red-500/10 text-red-400 px-2.5 py-1 rounded-full">
                        <XCircle className="w-3 h-3" />Erro
                      </span>
                    )}
                    <span className={`text-xs px-2.5 py-1 rounded-full ${cred.is_active ? 'bg-green-500/10 text-green-400' : 'bg-zinc-800 text-zinc-500'}`}>
                      {cred.is_active ? 'Ativa' : 'Inativa'}
                    </span>
                  </div>
                </div>

                {/* Edit form (inline) */}
                {isEditing && ef ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-500">Nome</label>
                      <input
                        type="text" value={ef.name}
                        onChange={e => setEditing(prev => ({ ...prev, [cred.id]: { ...prev[cred.id], name: e.target.value } }))}
                        className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-500">Email</label>
                      <input
                        type="email" value={ef.email}
                        onChange={e => setEditing(prev => ({ ...prev, [cred.id]: { ...prev[cred.id], email: e.target.value } }))}
                        className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-500">Nova Password (opcional)</label>
                      <div className="relative">
                        <input
                          type={ef.showPassword ? 'text' : 'password'} value={ef.password}
                          placeholder="Deixa vazio para manter"
                          onChange={e => setEditing(prev => ({ ...prev, [cred.id]: { ...prev[cred.id], password: e.target.value } }))}
                          className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand"
                        />
                        <button type="button" tabIndex={-1}
                          onClick={() => setEditing(prev => ({ ...prev, [cred.id]: { ...prev[cred.id], showPassword: !prev[cred.id].showPassword } }))}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                          {ef.showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Test error message */
                  cred.test_status === 'error' && cred.test_error && (
                    <div className="flex items-start gap-2 bg-red-950/30 border border-red-800/30 rounded-lg px-3 py-2 mb-4">
                      <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                      <p className="text-red-400 text-xs">{cred.test_error}</p>
                    </div>
                  )
                )}

                {/* Footer: last tested + actions */}
                <div className="flex items-center justify-between gap-3 pt-3 border-t border-zinc-800">
                  <span className="text-zinc-600 text-xs">
                    {cred.last_tested_at
                      ? `Testada ${new Date(cred.last_tested_at).toLocaleString('pt-PT')}`
                      : 'Nunca testada'}
                  </span>

                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <>
                        <button onClick={() => handleSaveEdit(cred.id)} disabled={isSaving}
                          className="flex items-center gap-1.5 text-xs bg-brand hover:bg-brand-dark disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors">
                          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          Guardar
                        </button>
                        <button onClick={() => cancelEdit(cred.id)}
                          className="text-xs text-zinc-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors">
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => handleTest(cred.id)} disabled={isTesting}
                          className="flex items-center gap-1.5 text-xs border border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors">
                          {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                          Testar conexão
                        </button>
                        <button onClick={() => startEdit(cred)}
                          className="flex items-center gap-1.5 text-xs border border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800 px-3 py-1.5 rounded-lg transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                          Editar
                        </button>
                        <button onClick={() => handleToggle(cred)}
                          className={`flex items-center gap-1.5 text-xs border px-3 py-1.5 rounded-lg transition-colors ${
                            cred.is_active
                              ? 'border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800'
                              : 'border-green-800/50 text-green-400 hover:bg-green-950/30'
                          }`}>
                          <Ban className="w-3.5 h-3.5" />
                          {cred.is_active ? 'Desativar' : 'Ativar'}
                        </button>
                        <button onClick={() => handleDelete(cred.id)}
                          className="text-zinc-600 hover:text-red-400 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Sync() {
  const [tab, setTab] = useState<Tab>('sync')
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [pipelineTabs, setPipelineTabs] = useState<PipelineTabInfo[]>([])

  const loadPipelines = useCallback(async () => {
    try {
      const res = await api.get<{ data: Pipeline[] }>('/api/pipelines')
      setPipelines(res.data)
      // Auto-open tabs for active pipelines
      setPipelineTabs(prev => {
        const next: PipelineTabInfo[] = []
        for (const p of res.data) {
          if (!p.is_active) continue
          const tabId = `pipeline_${p.worker_name}`
          const existing = prev.find(t => t.tabId === tabId)
          next.push(existing ?? {
            tabId,
            pipelineId: p.id,
            workerName: p.worker_name,
            workerUrl: p.worker_url,
            label: `Pipeline ${p.worker_name}`,
          })
        }
        return next
      })
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadPipelines() }, [loadPipelines])

  const handleActivatePipeline = async (worker: WorkerStatus): Promise<void> => {
    await api.post<Pipeline>('/api/pipelines', {
      worker_name: worker.name,
      worker_url: worker.url,
    })
    await loadPipelines()
    const tabId = `pipeline_${worker.name}`
    setTab(tabId)
  }

  const handleDeactivatePipeline = async (pipelineId: string) => {
    await api.patch(`/api/pipelines/${pipelineId}`, { is_active: false, status: 'stopped' })
    await loadPipelines()
  }

  const handleClosePipelineTab = (tabId: string) => {
    setPipelineTabs(prev => prev.filter(t => t.tabId !== tabId))
    if (tab === tabId) setTab('workers')
  }

  const handlePipelineUpdated = (p: Pipeline) => {
    setPipelines(prev => prev.map(x => x.id === p.id ? p : x))
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-white">Sincronização</h2>
        <p className="text-zinc-500 text-sm mt-1">Gestão da conexão com o 21online.app</p>
      </div>

      <TabBar
        active={tab}
        onChange={setTab}
        pipelineTabs={pipelineTabs}
        onClosePipelineTab={handleClosePipelineTab}
      />

      {tab === 'sync'        && <SyncTab />}
      {tab === 'workers'     && (
        <WorkersTab
          pipelines={pipelines}
          onActivatePipeline={handleActivatePipeline}
          onDeactivatePipeline={handleDeactivatePipeline}
        />
      )}
      {tab === 'endpoints'   && <EndPointsTab />}
      {tab === 'credentials' && <CredenciaisTab />}

      {pipelineTabs.map(pt => (
        <div key={pt.tabId} hidden={tab !== pt.tabId}>
          <PipelineTab
            pipelineId={pt.pipelineId}
            workerName={pt.workerName}
            workerUrl={pt.workerUrl}
            initialPipeline={pipelines.find(p => p.id === pt.pipelineId) ?? null}
            onPipelineUpdated={handlePipelineUpdated}
          />
        </div>
      ))}
    </div>
  )
}
