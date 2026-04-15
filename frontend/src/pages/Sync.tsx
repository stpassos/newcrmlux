import { useState, useEffect, useCallback, type ReactNode, type FormEvent } from 'react'
import { api } from '@/lib/api'
import {
  FolderSync, Plus, Trash2, Eye, EyeOff,
  CheckCircle2, XCircle, Loader2, RefreshCw, Wifi, WifiOff,
  Building2, Server, Activity
} from 'lucide-react'

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

// ─── Tab bar ──────────────────────────────────────────────────────────────────

type Tab = 'sync' | 'workers'

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'sync', label: 'Sincronização', icon: <FolderSync className="w-4 h-4" /> },
    { id: 'workers', label: 'Workers', icon: <Server className="w-4 h-4" /> },
  ]
  return (
    <div className="flex gap-1 border-b border-zinc-800 mb-8">
      {tabs.map(t => (
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
    </div>
  )
}

// ─── Workers tab ──────────────────────────────────────────────────────────────

function WorkersTab() {
  const [workers, setWorkers] = useState<WorkerStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

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
              <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center justify-between">
                <span className="text-zinc-600 text-xs">
                  HTTP {w.http_status ?? '—'}
                </span>
                <span className="text-zinc-600 text-xs">
                  {new Date(w.checked_at).toLocaleTimeString('pt-PT')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Sync tab (conteúdo existente) ────────────────────────────────────────────

function SyncTab() {
  const [connections, setConnections] = useState<CrmConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspacesLoading, setWorkspacesLoading] = useState(false)
  const [workspacesError, setWorkspacesError] = useState<string | null>(null)

  const loadConnections = useCallback(async () => {
    try {
      const res = await api.get<{ data: CrmConnection[] }>('/api/connections')
      setConnections(res.data)
      return res.data
    } catch {
      return []
    } finally {
      setLoading(false)
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
    loadConnections().then(conns => {
      if (conns.some(c => c.is_active)) loadWorkspaces()
    })
  }, [loadConnections, loadWorkspaces])

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    setFeedback(null)
    setSaving(true)
    try {
      const res = await api.post<{ worker_valid: boolean | null; worker_error?: string }>('/api/connections', { email, password })
      if (res.worker_valid === false) {
        setFeedback({ type: 'error', msg: res.worker_error || 'Credenciais inválidas no 21online.app.' })
      } else if (res.worker_valid === true) {
        setFeedback({ type: 'success', msg: 'Credenciais guardadas e validadas com sucesso.' })
        setEmail(''); setPassword(''); setShowForm(false)
      } else {
        setFeedback({ type: 'success', msg: 'Credenciais guardadas (validação indisponível).' })
        setEmail(''); setPassword(''); setShowForm(false)
      }
      const conns = await loadConnections()
      if (conns.some(c => c.is_active)) loadWorkspaces()
    } catch (err: unknown) {
      setFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Erro ao guardar.' })
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (conn: CrmConnection) => {
    try {
      await api.patch(`/api/connections/${conn.id}`, { is_active: !conn.is_active })
      const conns = await loadConnections()
      if (conns.some(c => c.is_active)) loadWorkspaces()
      else setWorkspaces([])
    } catch { /* ignore */ }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Remover esta conexão?')) return
    try {
      await api.delete(`/api/connections/${id}`)
      const conns = await loadConnections()
      if (conns.some(c => c.is_active)) loadWorkspaces()
      else setWorkspaces([])
    } catch { /* ignore */ }
  }

  const hasActiveConnection = connections.some(c => c.is_active)

  return (
    <>
      {/* Autenticação 21online */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="bg-zinc-800 rounded-lg p-2">
              <FolderSync className="w-5 h-5 text-brand" />
            </div>
            <div>
              <h3 className="text-white font-medium">Autenticação 21online.app</h3>
              <p className="text-zinc-500 text-xs">Credenciais usadas para importar imóveis, leads e utilizadores</p>
            </div>
          </div>
          {!showForm && (
            <button
              onClick={() => { setShowForm(true); setFeedback(null) }}
              className="flex items-center gap-2 bg-brand hover:bg-brand-dark text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              {connections.length > 0 ? 'Atualizar credenciais' : 'Adicionar conta'}
            </button>
          )}
        </div>

        {showForm && (
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 mb-4">
            <h4 className="text-white text-sm font-semibold mb-4">Credenciais de acesso ao 21online.app</h4>
            <form onSubmit={handleSave} className="space-y-4">
              {feedback && (
                <div className={`flex items-center gap-2 text-sm px-4 py-3 rounded-lg ${
                  feedback.type === 'success'
                    ? 'bg-green-950/50 border border-green-800/60 text-green-300'
                    : 'bg-red-950/50 border border-red-800/60 text-red-300'
                }`}>
                  {feedback.type === 'success'
                    ? <CheckCircle2 className="w-4 h-4 shrink-0" />
                    : <XCircle className="w-4 h-4 shrink-0" />}
                  {feedback.msg}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-400">Email 21online.app</label>
                  <input
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="email@exemplo.com" required
                    className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-colors"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-400">Password 21online.app</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'} value={password}
                      onChange={e => setPassword(e.target.value)} placeholder="••••••••" required
                      className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-colors"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300" tabIndex={-1}>
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button type="submit" disabled={saving}
                  className="flex items-center gap-2 bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Guardar credenciais
                </button>
                <button type="button" onClick={() => { setShowForm(false); setFeedback(null) }}
                  className="text-zinc-400 hover:text-white text-sm px-4 py-2.5 rounded-lg hover:bg-zinc-800 transition-colors">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-zinc-500 text-sm py-4">
            <Loader2 className="w-4 h-4 animate-spin" />A carregar...
          </div>
        ) : connections.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 border-dashed rounded-xl p-8 text-center">
            <WifiOff className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">Nenhuma conta 21online.app configurada.</p>
            <p className="text-zinc-600 text-xs mt-1">Adiciona as credenciais para ativar a sincronização.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {connections.map(conn => (
              <div key={conn.id} className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`p-1.5 rounded-full ${conn.is_active ? 'bg-green-500/10' : 'bg-zinc-800'}`}>
                    {conn.is_active
                      ? <Wifi className="w-4 h-4 text-green-400" />
                      : <WifiOff className="w-4 h-4 text-zinc-500" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{conn.email}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className={`text-xs font-medium ${conn.is_active ? 'text-green-400' : 'text-zinc-500'}`}>
                        {conn.is_active ? 'Ativa' : 'Inativa'}
                      </span>
                      {conn.has_session && (
                        <span className="text-xs text-zinc-500 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-green-500" />Sessão válida
                        </span>
                      )}
                      {conn.last_sync_at && (
                        <span className="text-xs text-zinc-600">
                          Último sync: {new Date(conn.last_sync_at).toLocaleDateString('pt-PT')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => { setEmail(conn.email); setShowForm(true); setFeedback(null) }}
                    className="text-zinc-400 hover:text-white p-2 rounded-lg hover:bg-zinc-800 transition-colors" title="Atualizar password">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleToggle(conn)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      conn.is_active
                        ? 'border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800'
                        : 'border-green-800/50 text-green-400 hover:bg-green-950/30'
                    }`}>
                    {conn.is_active ? 'Desativar' : 'Ativar'}
                  </button>
                  <button onClick={() => handleDelete(conn.id)}
                    className="text-zinc-600 hover:text-red-400 p-2 rounded-lg hover:bg-zinc-800 transition-colors" title="Remover">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Workspaces */}
      {hasActiveConnection && (
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Sync() {
  const [tab, setTab] = useState<Tab>('sync')

  return (
    <div className="p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-white">Sincronização</h2>
        <p className="text-zinc-500 text-sm mt-1">Gestão da conexão com o 21online.app</p>
      </div>

      <TabBar active={tab} onChange={setTab} />

      {tab === 'sync' && <SyncTab />}
      {tab === 'workers' && <WorkersTab />}
    </div>
  )
}
