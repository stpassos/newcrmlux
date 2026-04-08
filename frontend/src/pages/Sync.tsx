import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import {
  FolderSync, Plus, Trash2, Eye, EyeOff,
  CheckCircle2, XCircle, Loader2, RefreshCw, Wifi, WifiOff
} from 'lucide-react'

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

export default function Sync() {
  const [connections, setConnections] = useState<CrmConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const loadConnections = async () => {
    try {
      const res = await api.get<{ data: CrmConnection[] }>('/api/connections')
      setConnections(res.data)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadConnections()
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setFeedback(null)
    setSaving(true)
    try {
      const res = await api.post<{ worker_valid: boolean | null; worker_error?: string }>('/api/connections', { email, password })
      if (res.worker_valid === false) {
        setFeedback({ type: 'error', msg: res.worker_error || 'Credenciais inválidas no 21online.app.' })
      } else if (res.worker_valid === true) {
        setFeedback({ type: 'success', msg: 'Credenciais guardadas e validadas com sucesso.' })
        setEmail('')
        setPassword('')
        setShowForm(false)
      } else {
        setFeedback({ type: 'success', msg: 'Credenciais guardadas (validação indisponível).' })
        setEmail('')
        setPassword('')
        setShowForm(false)
      }
      loadConnections()
    } catch (err: unknown) {
      setFeedback({ type: 'error', msg: err instanceof Error ? err.message : 'Erro ao guardar.' })
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (conn: CrmConnection) => {
    try {
      await api.patch(`/api/connections/${conn.id}`, { is_active: !conn.is_active })
      loadConnections()
    } catch {
      // ignore
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Remover esta conexão?')) return
    try {
      await api.delete(`/api/connections/${id}`)
      loadConnections()
    } catch {
      // ignore
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-white">Sincronização</h2>
        <p className="text-zinc-500 text-sm mt-1">Gestão da conexão com o 21online.app</p>
      </div>

      {/* Secção de autenticação 21online */}
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

        {/* Formulário */}
        {showForm && (
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 mb-4">
            <h4 className="text-white text-sm font-semibold mb-4">
              Credenciais de acesso ao 21online.app
            </h4>
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
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="email@exemplo.com"
                    required
                    className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-400">Password 21online.app</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      className="w-full bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-600 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Guardar credenciais
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setFeedback(null) }}
                  className="text-zinc-400 hover:text-white text-sm px-4 py-2.5 rounded-lg hover:bg-zinc-800 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Lista de conexões */}
        {loading ? (
          <div className="flex items-center gap-2 text-zinc-500 text-sm py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            A carregar...
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
              <div
                key={conn.id}
                className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 flex items-center justify-between gap-4"
              >
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
                          <CheckCircle2 className="w-3 h-3 text-green-500" />
                          Sessão válida
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
                  <button
                    onClick={() => { setEmail(conn.email); setShowForm(true); setFeedback(null) }}
                    className="text-zinc-400 hover:text-white p-2 rounded-lg hover:bg-zinc-800 transition-colors"
                    title="Atualizar password"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleToggle(conn)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                      conn.is_active
                        ? 'border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800'
                        : 'border-green-800/50 text-green-400 hover:bg-green-950/30'
                    }`}
                  >
                    {conn.is_active ? 'Desativar' : 'Ativar'}
                  </button>
                  <button
                    onClick={() => handleDelete(conn.id)}
                    className="text-zinc-600 hover:text-red-400 p-2 rounded-lg hover:bg-zinc-800 transition-colors"
                    title="Remover"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Sync Jobs */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-white font-medium">Histórico de sincronizações</h3>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 border-dashed rounded-xl p-6 text-center">
          <p className="text-zinc-500 text-sm">O histórico de sincronizações será apresentado aqui.</p>
        </div>
      </section>
    </div>
  )
}
