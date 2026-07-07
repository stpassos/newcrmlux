import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import {
  Bell, Phone, Cpu, HardDrive, CheckCircle2, XCircle,
  AlertTriangle, Send, Save, Loader2, RefreshCw, Clock,
  MessageSquare, ToggleLeft, ToggleRight, Activity,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NotificationConfig {
  id: number
  phone_number: string
  enabled: boolean
  cpu_threshold: number | null
  ram_threshold: number | null
  disk_threshold: number | null
  cpu_message: string
  ram_message: string
  disk_message: string
  job_fail_message: string
  job_cancel_message: string
  monitored_endpoints: string[]
  cooldown_minutes: number
  updated_at: string
}

interface ConfigResponse {
  config: NotificationConfig | null
  available_endpoints: string[]
}

interface LogEntry {
  id: number
  type: string
  details: string | null
  phone_number: string | null
  success: boolean
  error_msg: string | null
  sent_at: string
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_FORM = {
  phone_number: '',
  enabled: false,
  cpu_threshold_enabled: false,
  cpu_threshold: 85,
  cpu_message: 'Alerta CRM: CPU {value}% (limite: {threshold}%)',
  ram_threshold_enabled: false,
  ram_threshold: 85,
  ram_message: 'Alerta CRM: RAM {value}% (limite: {threshold}%)',
  disk_threshold_enabled: false,
  disk_threshold: 90,
  disk_message: 'Alerta CRM: Disco {value}% (limite: {threshold}%)',
  job_fail_message: 'CRM Job falhou - {endpoint} ({workspace}): {error}',
  job_cancel_message: 'CRM Job cancelado - {endpoint} ({workspace})',
  monitored_endpoints: [] as string[],
  cooldown_minutes: 15,
}

type FormState = typeof DEFAULT_FORM

// ─── Helper components ────────────────────────────────────────────────────────

function SectionCard({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-zinc-400" />
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-zinc-400 mb-1">{children}</p>
}

function HintText({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-zinc-600 mt-1">{children}</p>
}

function ThresholdRow({
  label,
  icon: Icon,
  enabled,
  onToggle,
  value,
  onChange,
  message,
  onMessageChange,
  placeholders,
  color,
}: {
  label: string
  icon: React.ElementType
  enabled: boolean
  onToggle: () => void
  value: number
  onChange: (v: number) => void
  message: string
  onMessageChange: (v: string) => void
  placeholders: string
  color: string
}) {
  return (
    <div className={`rounded-lg border p-4 transition-colors ${enabled ? 'border-zinc-700 bg-zinc-800/50' : 'border-zinc-800 bg-zinc-900'}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${enabled ? color : 'text-zinc-600'}`} />
          <span className={`text-sm font-medium ${enabled ? 'text-white' : 'text-zinc-500'}`}>{label}</span>
        </div>
        <button
          onClick={onToggle}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
            enabled
              ? 'border-emerald-700 text-emerald-400 bg-emerald-900/30'
              : 'border-zinc-700 text-zinc-500 bg-zinc-800'
          }`}
        >
          {enabled ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
          {enabled ? 'Activo' : 'Inactivo'}
        </button>
      </div>

      {enabled && (
        <div className="space-y-3">
          <div>
            <div className="flex justify-between mb-1">
              <Label>Limite de alerta</Label>
              <span className="text-xs font-mono text-white">{value}%</span>
            </div>
            <input
              type="range"
              min={1}
              max={99}
              value={value}
              onChange={e => onChange(parseInt(e.target.value))}
              className="w-full accent-emerald-500 h-1.5 rounded-full"
            />
            <div className="flex justify-between text-xs text-zinc-600 mt-0.5">
              <span>1%</span><span>99%</span>
            </div>
          </div>
          <div>
            <Label>Texto da notificação</Label>
            <textarea
              value={message}
              onChange={e => onMessageChange(e.target.value)}
              rows={2}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
            />
            <HintText>Variáveis disponíveis: {placeholders}</HintText>
          </div>
        </div>
      )}
    </div>
  )
}

function typeLabel(type: string) {
  const map: Record<string, string> = {
    cpu: 'CPU', ram: 'RAM', disk: 'Disco',
    job_fail: 'Job Falhou', job_cancel: 'Job Cancelado', test: 'Teste',
  }
  return map[type] || type
}

function typeBadgeClass(type: string) {
  const map: Record<string, string> = {
    cpu: 'text-orange-400 bg-orange-900/30 border-orange-800',
    ram: 'text-blue-400 bg-blue-900/30 border-blue-800',
    disk: 'text-yellow-400 bg-yellow-900/30 border-yellow-800',
    job_fail: 'text-red-400 bg-red-900/30 border-red-800',
    job_cancel: 'text-amber-400 bg-amber-900/30 border-amber-800',
    test: 'text-zinc-400 bg-zinc-800 border-zinc-700',
  }
  return map[type] || 'text-zinc-400 bg-zinc-800 border-zinc-700'
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Notificacoes() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [availableEndpoints, setAvailableEndpoints] = useState<string[]>([])
  const [log, setLog] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [logLoading, setLogLoading] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const set = (patch: Partial<FormState>) => setForm(f => ({ ...f, ...patch }))

  // ── Load config ─────────────────────────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    try {
      const data = await api.get<ConfigResponse>('/api/notifications/config')
      setAvailableEndpoints(data.available_endpoints || [])
      const c = data.config
      if (c) {
        set({
          phone_number: c.phone_number || '',
          enabled: c.enabled,
          cpu_threshold_enabled: c.cpu_threshold != null,
          cpu_threshold: c.cpu_threshold ?? 85,
          cpu_message: c.cpu_message,
          ram_threshold_enabled: c.ram_threshold != null,
          ram_threshold: c.ram_threshold ?? 85,
          ram_message: c.ram_message,
          disk_threshold_enabled: c.disk_threshold != null,
          disk_threshold: c.disk_threshold ?? 90,
          disk_message: c.disk_message,
          job_fail_message: c.job_fail_message,
          job_cancel_message: c.job_cancel_message,
          monitored_endpoints: Array.isArray(c.monitored_endpoints) ? c.monitored_endpoints : [],
          cooldown_minutes: c.cooldown_minutes ?? 15,
        })
      }
    } catch {
      // ignore — table may not exist yet (first load before migration runs)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadLog = useCallback(async () => {
    setLogLoading(true)
    try {
      const rows = await api.get<LogEntry[]>('/api/notifications/log')
      setLog(rows)
    } catch {
      setLog([])
    } finally {
      setLogLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
    loadLog()
  }, [loadConfig, loadLog])

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true)
    setSaveMsg(null)
    try {
      await api.post('/api/notifications/config', {
        phone_number: form.phone_number,
        enabled: form.enabled,
        cpu_threshold: form.cpu_threshold_enabled ? form.cpu_threshold : null,
        ram_threshold: form.ram_threshold_enabled ? form.ram_threshold : null,
        disk_threshold: form.disk_threshold_enabled ? form.disk_threshold : null,
        cpu_message: form.cpu_message,
        ram_message: form.ram_message,
        disk_message: form.disk_message,
        job_fail_message: form.job_fail_message,
        job_cancel_message: form.job_cancel_message,
        monitored_endpoints: form.monitored_endpoints,
        cooldown_minutes: form.cooldown_minutes,
      })
      setSaveMsg({ ok: true, text: 'Configuração guardada.' })
    } catch (e: unknown) {
      setSaveMsg({ ok: false, text: e instanceof Error ? e.message : 'Erro ao guardar.' })
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg(null), 4000)
    }
  }

  // ── Test SMS ────────────────────────────────────────────────────────────────
  const handleTest = async () => {
    if (!form.phone_number) return
    setTesting(true)
    setTestMsg(null)
    try {
      await api.post('/api/notifications/test', { phone_number: form.phone_number })
      setTestMsg({ ok: true, text: 'SMS de teste enviado!' })
      loadLog()
    } catch (e: unknown) {
      setTestMsg({ ok: false, text: e instanceof Error ? e.message : 'Erro ao enviar SMS.' })
    } finally {
      setTesting(false)
      setTimeout(() => setTestMsg(null), 5000)
    }
  }

  // ── Endpoint toggle ─────────────────────────────────────────────────────────
  const toggleEndpoint = (name: string) => {
    set({
      monitored_endpoints: form.monitored_endpoints.includes(name)
        ? form.monitored_endpoints.filter(e => e !== name)
        : [...form.monitored_endpoints, name],
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Bell className="w-5 h-5 text-zinc-400" />
            <h1 className="text-xl font-semibold text-white">Notificações</h1>
          </div>
          <p className="text-sm text-zinc-500">Alertas por SMS via sms.century21lux.pt</p>
        </div>

        <div className="flex items-center gap-2">
          {saveMsg && (
            <span className={`text-xs ${saveMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {saveMsg.text}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Guardar
          </button>
        </div>
      </div>

      {/* ── General settings ───────────────────────────────────────────────── */}
      <SectionCard title="Configuração Geral" icon={Phone}>
        {/* Enable toggle */}
        <div className="flex items-center justify-between mb-4 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
          <div>
            <p className="text-sm font-medium text-white">Notificações activas</p>
            <p className="text-xs text-zinc-500 mt-0.5">Activar ou desactivar todos os alertas</p>
          </div>
          <button
            onClick={() => set({ enabled: !form.enabled })}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition-colors ${
              form.enabled
                ? 'border-emerald-700 text-emerald-400 bg-emerald-900/30'
                : 'border-zinc-700 text-zinc-400 bg-zinc-800'
            }`}
          >
            {form.enabled
              ? <><ToggleRight className="w-4 h-4" /> Activo</>
              : <><ToggleLeft className="w-4 h-4" /> Inactivo</>
            }
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Phone number */}
          <div className="sm:col-span-2">
            <Label>Número de destino</Label>
            <div className="flex gap-2">
              <input
                type="tel"
                value={form.phone_number}
                onChange={e => set({ phone_number: e.target.value })}
                placeholder="+351912345678"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
              <button
                onClick={handleTest}
                disabled={testing || !form.phone_number}
                className="flex items-center gap-2 px-3 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white text-sm rounded-lg transition-colors whitespace-nowrap"
              >
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Testar
              </button>
            </div>
            {testMsg && (
              <p className={`text-xs mt-1.5 ${testMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {testMsg.text}
              </p>
            )}
            <HintText>Formato internacional, ex: +351912345678</HintText>
          </div>

          {/* Cooldown */}
          <div>
            <Label>Intervalo mínimo entre alertas (minutos)</Label>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-zinc-500" />
              <input
                type="number"
                min={1}
                max={1440}
                value={form.cooldown_minutes}
                onChange={e => set({ cooldown_minutes: parseInt(e.target.value) || 15 })}
                className="w-24 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
              />
              <span className="text-xs text-zinc-500">min</span>
            </div>
            <HintText>Evita spam para o mesmo tipo de alerta</HintText>
          </div>
        </div>
      </SectionCard>

      {/* ── System metrics ─────────────────────────────────────────────────── */}
      <SectionCard title="Alertas de Sistema" icon={Activity}>
        <div className="space-y-3">
          <ThresholdRow
            label="CPU"
            icon={Cpu}
            color="text-orange-400"
            enabled={form.cpu_threshold_enabled}
            onToggle={() => set({ cpu_threshold_enabled: !form.cpu_threshold_enabled })}
            value={form.cpu_threshold}
            onChange={v => set({ cpu_threshold: v })}
            message={form.cpu_message}
            onMessageChange={v => set({ cpu_message: v })}
            placeholders="{value}, {threshold}"
          />
          <ThresholdRow
            label="RAM"
            icon={Activity}
            color="text-blue-400"
            enabled={form.ram_threshold_enabled}
            onToggle={() => set({ ram_threshold_enabled: !form.ram_threshold_enabled })}
            value={form.ram_threshold}
            onChange={v => set({ ram_threshold: v })}
            message={form.ram_message}
            onMessageChange={v => set({ ram_message: v })}
            placeholders="{value}, {threshold}"
          />
          <ThresholdRow
            label="Disco"
            icon={HardDrive}
            color="text-yellow-400"
            enabled={form.disk_threshold_enabled}
            onToggle={() => set({ disk_threshold_enabled: !form.disk_threshold_enabled })}
            value={form.disk_threshold}
            onChange={v => set({ disk_threshold: v })}
            message={form.disk_message}
            onMessageChange={v => set({ disk_message: v })}
            placeholders="{value}, {threshold}"
          />
        </div>
      </SectionCard>

      {/* ── Job alerts ─────────────────────────────────────────────────────── */}
      <SectionCard title="Alertas de Jobs" icon={AlertTriangle}>
        <div className="space-y-4">
          <div>
            <Label>Endpoints a monitorizar</Label>
            {availableEndpoints.length === 0 ? (
              <p className="text-xs text-zinc-600 py-2">Nenhum endpoint encontrado. Configure primeiro um pipeline.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1">
                {availableEndpoints.map(ep => (
                  <label
                    key={ep}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors ${
                      form.monitored_endpoints.includes(ep)
                        ? 'border-emerald-700 bg-emerald-900/20 text-emerald-300'
                        : 'border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={form.monitored_endpoints.includes(ep)}
                      onChange={() => toggleEndpoint(ep)}
                      className="sr-only"
                    />
                    <div className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${
                      form.monitored_endpoints.includes(ep)
                        ? 'border-emerald-500 bg-emerald-500'
                        : 'border-zinc-600'
                    }`}>
                      {form.monitored_endpoints.includes(ep) && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span className="truncate">{ep}</span>
                  </label>
                ))}
              </div>
            )}
            <HintText>Receberá alerta quando um job destes endpoints falhar ou for cancelado</HintText>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div>
              <Label>Mensagem — job falhado</Label>
              <textarea
                value={form.job_fail_message}
                onChange={e => set({ job_fail_message: e.target.value })}
                rows={2}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
              />
              <HintText>Variáveis: {'{endpoint}'}, {'{workspace}'}, {'{error}'}</HintText>
            </div>
            <div>
              <Label>Mensagem — job cancelado</Label>
              <textarea
                value={form.job_cancel_message}
                onChange={e => set({ job_cancel_message: e.target.value })}
                rows={2}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
              />
              <HintText>Variáveis: {'{endpoint}'}, {'{workspace}'}</HintText>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* ── Notification log ───────────────────────────────────────────────── */}
      <SectionCard title="Histórico de Notificações" icon={MessageSquare}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-zinc-500">Últimas 50 notificações enviadas</p>
          <button
            onClick={loadLog}
            disabled={logLoading}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${logLoading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>

        {log.length === 0 ? (
          <p className="text-sm text-zinc-600 text-center py-8">Nenhuma notificação enviada ainda.</p>
        ) : (
          <div className="space-y-1.5">
            {log.map(entry => (
              <div
                key={entry.id}
                className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-zinc-800/50 border border-zinc-800"
              >
                {entry.success
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  : <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                }
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${typeBadgeClass(entry.type)}`}>
                      {typeLabel(entry.type)}
                    </span>
                    {entry.details && (
                      <span className="text-xs text-zinc-400 truncate">{entry.details}</span>
                    )}
                  </div>
                  {entry.error_msg && (
                    <p className="text-xs text-red-400 mt-0.5">{entry.error_msg}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-zinc-500">
                    {new Date(entry.sent_at).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                  {entry.phone_number && (
                    <p className="text-xs text-zinc-600">{entry.phone_number}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
