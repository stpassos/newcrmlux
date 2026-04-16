import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import {
  Cpu, MemoryStick, HardDrive, Activity, Server, Layers,
  CheckCircle2, XCircle, Clock, AlertTriangle, RefreshCw,
  Loader2, Wifi, TrendingUp, TrendingDown, Zap, CircleDot,
} from 'lucide-react'
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServerSnapshot {
  id: number
  collected_at: string
  server_ip: string
  cpu_pct: number
  ram_used_mb: number
  ram_total_mb: number
  disk_used_gb: number
  disk_total_gb: number
  net_rx_kbps: number
  net_tx_kbps: number
  load_1: number
  load_5: number
}

interface WorkerMetric {
  id: number
  collected_at: string
  worker_name: string
  pm2_status: string
  pm2_pid: number | null
  cpu_pct: number
  ram_mb: number
  restarts: number
  uptime_ms: number
  active_jobs: number
}

interface CurrentData {
  server: ServerSnapshot | null
  workers: WorkerMetric[]
  pipeline: {
    endpoint_name: string
    status: string
    last_run_at: string | null
    last_fetched: number
    worker_name: string
    interval_min: number
    interval_max: number
  } | null
  jobs_running: number
  jobs_queued: number
  avg_duration_ms: number
  avg_queue_ms: number
  last_error: string | null
  last_error_at: string | null
  last_updated: string | null
}

interface HistoryPoint {
  t: string
  cpu_pct: number
  ram_pct: number
  net_rx: number
  net_tx: number
}

interface JobPoint {
  t: string
  completed: number
  failed: number
  avg_duration_s: number
}

interface HistoryData {
  interval: string
  metrics: HistoryPoint[]
  jobs: JobPoint[]
}

interface JobLog {
  id: string
  entity: string
  workspace_name: string | null
  status: string
  fetched: number
  inserted: number
  duration_ms: number | null
  error_msg: string | null
  started_at: string
  finished_at: string | null
  credential_name: string | null
  worker_name: string | null
}

interface LogsData {
  jobs: JobLog[]
  agent_logs: { id: number; logged_at: string; worker_name: string; status: string; entity: string | null; fetched: number; error_msg: string | null }[]
}

type IntervalKey = '1h' | '24h' | '7d'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(used: number, total: number) {
  if (!total) return 0
  return Math.round((used / total) * 1000) / 10
}

function fmtBytes(kb: number) {
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB/s`
  return `${kb.toFixed(1)} KB/s`
}

function fmtUptime(ms: number) {
  const s = Math.floor(ms / 1000)
  if (s < 60)   return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  return `${Math.floor(s / 86400)}d`
}

function fmtDuration(ms: number | null) {
  if (!ms) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function timeLabel(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
}

function ago(iso: string | null) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60)  return `há ${s}s`
  if (s < 3600) return `há ${Math.floor(s / 60)}m`
  return `há ${Math.floor(s / 3600)}h`
}

// ─── Gauge bar ────────────────────────────────────────────────────────────────

function GaugeBar({ value, warn = 70, danger = 90 }: { value: number; warn?: number; danger?: number }) {
  const color = value >= danger ? 'bg-red-500' : value >= warn ? 'bg-yellow-500' : 'bg-emerald-500'
  return (
    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden mt-1.5">
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  )
}

// ─── Section 1: Overview ──────────────────────────────────────────────────────

function MetricsOverview({ data, loading }: { data: CurrentData | null; loading: boolean }) {
  const s = data?.server

  const ramPct = s ? pct(s.ram_used_mb, s.ram_total_mb) : 0
  const diskPct = s ? pct(s.disk_used_gb, s.disk_total_gb) : 0

  const cards = [
    {
      icon: <Cpu className="w-5 h-5" />,
      label: 'CPU',
      value: s ? `${s.cpu_pct.toFixed(1)}%` : '—',
      sub: s ? `Load: ${s.load_1.toFixed(2)} / ${s.load_5.toFixed(2)}` : '',
      gauge: s?.cpu_pct ?? 0,
    },
    {
      icon: <MemoryStick className="w-5 h-5" />,
      label: 'RAM',
      value: s ? `${ramPct}%` : '—',
      sub: s ? `${s.ram_used_mb} MB / ${s.ram_total_mb} MB` : '',
      gauge: ramPct,
    },
    {
      icon: <HardDrive className="w-5 h-5" />,
      label: 'Disco',
      value: s ? `${diskPct}%` : '—',
      sub: s ? `${s.disk_used_gb} GB / ${s.disk_total_gb} GB` : '',
      gauge: diskPct,
    },
    {
      icon: <TrendingDown className="w-5 h-5 text-sky-400" />,
      label: 'Download',
      value: s ? fmtBytes(s.net_rx_kbps) : '—',
      sub: 'Entrada',
      gauge: null,
    },
    {
      icon: <TrendingUp className="w-5 h-5 text-violet-400" />,
      label: 'Upload',
      value: s ? fmtBytes(s.net_tx_kbps) : '—',
      sub: 'Saída',
      gauge: null,
    },
    {
      icon: <Server className="w-5 h-5 text-zinc-400" />,
      label: 'Servidor',
      value: s?.server_ip || '—',
      sub: s ? `Atualizado ${ago(s.collected_at)}` : 'Sem dados',
      gauge: null,
    },
    {
      icon: <Zap className="w-5 h-5 text-green-400" />,
      label: 'Jobs Activos',
      value: data ? String(data.jobs_running) : '—',
      sub: data ? `${data.jobs_queued} em fila` : '',
      gauge: null,
    },
  ]

  return (
    <section>
      <SectionHeader icon={<Activity className="w-5 h-5 text-brand" />} title="Overview" sub="Tempo real — atualização a cada 15s" loading={loading} />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {cards.map(c => (
          <div key={c.label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-zinc-500 mb-2">
              {c.icon}
              <span className="text-xs font-medium uppercase tracking-wide">{c.label}</span>
            </div>
            <p className="text-white text-xl font-semibold font-mono">{c.value}</p>
            <p className="text-zinc-600 text-xs mt-0.5 truncate">{c.sub}</p>
            {c.gauge !== null && <GaugeBar value={c.gauge} />}
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Section 2: Workers ───────────────────────────────────────────────────────

function WorkersStatus({ workers, loading }: { workers: WorkerMetric[]; loading: boolean }) {
  function statusDot(s: string) {
    if (s === 'online') return 'bg-emerald-400'
    if (s === 'stopping' || s === 'launching') return 'bg-yellow-400 animate-pulse'
    return 'bg-red-500'
  }
  function statusLabel(s: string) {
    const map: Record<string, string> = { online: 'Online', stopped: 'Parado', errored: 'Erro', stopping: 'A parar', launching: 'A iniciar' }
    return map[s] ?? s
  }

  return (
    <section>
      <SectionHeader icon={<Server className="w-5 h-5 text-brand" />} title="Workers" sub="Estado actual dos processos PM2" loading={loading} />
      {workers.length === 0 ? (
        <EmptyState text="Sem dados de workers — agente ainda não enviou métricas" />
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-3">Worker</th>
                <th className="text-left px-4 py-3">Estado</th>
                <th className="text-right px-4 py-3">CPU</th>
                <th className="text-right px-4 py-3">RAM</th>
                <th className="text-right px-4 py-3">Uptime</th>
                <th className="text-right px-4 py-3">Restarts</th>
                <th className="text-right px-4 py-3">Jobs Activos</th>
              </tr>
            </thead>
            <tbody>
              {workers.map(w => (
                <tr key={w.worker_name} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-white">{w.worker_name}</td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${statusDot(w.pm2_status)}`} />
                      <span className="text-zinc-300">{statusLabel(w.pm2_status)}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={w.cpu_pct > 80 ? 'text-red-400 font-medium' : w.cpu_pct > 50 ? 'text-yellow-400' : 'text-zinc-300'}>
                      {w.cpu_pct.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-300">{w.ram_mb.toFixed(0)} MB</td>
                  <td className="px-4 py-3 text-right text-zinc-400 font-mono text-xs">{fmtUptime(w.uptime_ms)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={w.restarts > 5 ? 'text-red-400' : 'text-zinc-400'}>{w.restarts}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {w.active_jobs > 0
                      ? <span className="text-green-400 font-medium">{w.active_jobs}</span>
                      : <span className="text-zinc-600">0</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ─── Section 3: Pipeline Health ───────────────────────────────────────────────

function PipelineHealth({ data, loading }: { data: CurrentData | null; loading: boolean }) {
  const p = data?.pipeline

  const stats = [
    { label: 'Endpoint activo', value: p?.endpoint_name ?? '—', icon: <CircleDot className="w-4 h-4" /> },
    { label: 'Worker', value: p?.worker_name ?? '—', icon: <Server className="w-4 h-4" /> },
    { label: 'Duração média', value: fmtDuration(data?.avg_duration_ms ?? null), icon: <Clock className="w-4 h-4" /> },
    { label: 'Tempo médio em fila', value: fmtDuration(data?.avg_queue_ms ?? null), icon: <Layers className="w-4 h-4" /> },
  ]

  return (
    <section>
      <SectionHeader icon={<Zap className="w-5 h-5 text-brand" />} title="Pipeline Health" sub="Estado dos pipelines e jobs" loading={loading} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Stats row */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
          {stats.map(s => (
            <div key={s.label} className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-zinc-500 text-sm">
                {s.icon}
                {s.label}
              </span>
              <span className="text-white text-sm font-medium">{s.value}</span>
            </div>
          ))}
        </div>

        {/* Last error */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">Último Erro</p>
          {data?.last_error ? (
            <div>
              <p className="text-red-400 text-sm font-mono break-all">{data.last_error}</p>
              <p className="text-zinc-600 text-xs mt-2">{ago(data.last_error_at)}</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-sm">Sem erros recentes</span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// ─── Section 4: Charts ────────────────────────────────────────────────────────

const TOOLTIP_STYLE = {
  backgroundColor: '#18181b',
  border: '1px solid #3f3f46',
  borderRadius: '8px',
  color: '#e4e4e7',
  fontSize: 12,
}

function MetricsCharts({ history, interval, onInterval, loading }: {
  history: HistoryData | null
  interval: IntervalKey
  onInterval: (i: IntervalKey) => void
  loading: boolean
}) {
  const metrics = (history?.metrics ?? []).map(d => ({
    ...d,
    t: timeLabel(d.t),
  }))
  const jobs = (history?.jobs ?? []).map(d => ({
    ...d,
    t: timeLabel(d.t),
  }))

  const intervals: IntervalKey[] = ['1h', '24h', '7d']

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="bg-zinc-800 rounded-lg p-2">
            <TrendingUp className="w-5 h-5 text-brand" />
          </div>
          <div>
            <h4 className="text-white font-medium">Histórico</h4>
            <p className="text-zinc-500 text-xs">Métricas do servidor ao longo do tempo</p>
          </div>
          {loading && <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />}
        </div>
        <div className="flex gap-1">
          {intervals.map(i => (
            <button
              key={i}
              onClick={() => onInterval(i)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                interval === i ? 'bg-brand text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {i}
            </button>
          ))}
        </div>
      </div>

      {metrics.length === 0 ? (
        <EmptyState text="Sem dados históricos — os gráficos aparecerão após o agente enviar métricas" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* CPU */}
          <ChartCard title="CPU (%)" color="#22c55e">
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={metrics}>
                <defs>
                  <linearGradient id="cpu-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="t" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} unit="%" />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v}%`, 'CPU']} />
                <Area type="monotone" dataKey="cpu_pct" stroke="#22c55e" fill="url(#cpu-grad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* RAM */}
          <ChartCard title="RAM (%)" color="#818cf8">
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={metrics}>
                <defs>
                  <linearGradient id="ram-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#818cf8" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="t" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} unit="%" />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v}%`, 'RAM']} />
                <Area type="monotone" dataKey="ram_pct" stroke="#818cf8" fill="url(#ram-grad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Network */}
          <ChartCard title="Network (KB/s)" color="#38bdf8">
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={metrics}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="t" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [`${v} KB/s`, name === 'net_rx' ? 'Download' : 'Upload']} />
                <Legend formatter={(v: string) => v === 'net_rx' ? 'Download' : 'Upload'} wrapperStyle={{ fontSize: 11, color: '#71717a' }} />
                <Line type="monotone" dataKey="net_rx" stroke="#38bdf8" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="net_tx" stroke="#a78bfa" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Jobs */}
          <ChartCard title="Jobs Executados" color="#f59e0b">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={jobs}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="t" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#71717a' }} />
                <Bar dataKey="completed" name="Concluídos" fill="#22c55e" radius={[2, 2, 0, 0]} />
                <Bar dataKey="failed"    name="Falhados"   fill="#ef4444" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}
    </section>
  )
}

function ChartCard({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-zinc-300 text-sm font-medium">{title}</span>
      </div>
      {children}
    </div>
  )
}

// ─── Section 5: Logs ──────────────────────────────────────────────────────────

function LogsList({ logs, loading }: { logs: LogsData | null; loading: boolean }) {
  const [view, setView] = useState<'jobs' | 'agent'>('jobs')
  const jobs = logs?.jobs ?? []
  const agentLogs = logs?.agent_logs ?? []

  function statusBadge(s: string) {
    if (s === 'done' || s === 'completed') return 'text-emerald-400 bg-emerald-500/10'
    if (s === 'error'  || s === 'failed')  return 'text-red-400 bg-red-500/10'
    if (s === 'running'|| s === 'started') return 'text-blue-400 bg-blue-500/10'
    return 'text-zinc-400 bg-zinc-800'
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <SectionHeaderInline icon={<Layers className="w-5 h-5 text-brand" />} title="Logs" sub="Histórico de jobs e eventos" loading={loading} />
        <div className="flex gap-1">
          {(['jobs', 'agent'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${view === v ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
              {v === 'jobs' ? 'Pipeline Jobs' : 'Agente'}
            </button>
          ))}
        </div>
      </div>

      {view === 'jobs' && (
        jobs.length === 0 ? <EmptyState text="Sem jobs registados" /> : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Entidade</th>
                  <th className="text-left px-4 py-3">Workspace</th>
                  <th className="text-left px-4 py-3">Credencial</th>
                  <th className="text-left px-4 py-3">Estado</th>
                  <th className="text-right px-4 py-3">Fetch</th>
                  <th className="text-right px-4 py-3">Ins</th>
                  <th className="text-right px-4 py-3">Duração</th>
                  <th className="text-right px-4 py-3">Início</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(j => (
                  <tr key={j.id} className="border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-white">{j.entity ?? '—'}</td>
                    <td className="px-4 py-2.5 text-zinc-400">{j.workspace_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-zinc-400">{j.credential_name ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(j.status)}`}>{j.status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-zinc-300">{j.fetched}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-zinc-300">{j.inserted}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-zinc-500 text-xs">{fmtDuration(j.duration_ms)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-zinc-600 text-xs">
                      {new Date(j.started_at).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {view === 'agent' && (
        agentLogs.length === 0 ? <EmptyState text="Sem logs do agente" /> : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Worker</th>
                  <th className="text-left px-4 py-3">Entidade</th>
                  <th className="text-left px-4 py-3">Estado</th>
                  <th className="text-right px-4 py-3">Fetch</th>
                  <th className="text-right px-4 py-3">Erro</th>
                  <th className="text-right px-4 py-3">Data</th>
                </tr>
              </thead>
              <tbody>
                {agentLogs.map(l => (
                  <tr key={l.id} className="border-b border-zinc-800/40 last:border-0">
                    <td className="px-4 py-2.5 text-zinc-300">{l.worker_name}</td>
                    <td className="px-4 py-2.5 text-zinc-400">{l.entity ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(l.status)}`}>{l.status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-zinc-400">{l.fetched}</td>
                    <td className="px-4 py-2.5 text-right text-red-400 text-xs max-w-xs truncate">{l.error_msg ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-zinc-600 text-xs">{ago(l.logged_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </section>
  )
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function SectionHeader({ icon, title, sub, loading }: { icon: React.ReactNode; title: string; sub: string; loading: boolean }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="bg-zinc-800 rounded-lg p-2">{icon}</div>
      <div>
        <h4 className="text-white font-medium">{title}</h4>
        <p className="text-zinc-500 text-xs">{sub}</p>
      </div>
      {loading && <Loader2 className="w-4 h-4 text-zinc-500 animate-spin ml-1" />}
    </div>
  )
}

function SectionHeaderInline({ icon, title, sub, loading }: { icon: React.ReactNode; title: string; sub: string; loading: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="bg-zinc-800 rounded-lg p-2">{icon}</div>
      <div>
        <h4 className="text-white font-medium">{title}</h4>
        <p className="text-zinc-500 text-xs">{sub}</p>
      </div>
      {loading && <Loader2 className="w-4 h-4 text-zinc-500 animate-spin ml-1" />}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 flex flex-col items-center gap-3 text-center">
      <AlertTriangle className="w-8 h-8 text-zinc-700" />
      <p className="text-zinc-500 text-sm max-w-sm">{text}</p>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ServerMonitorTab() {
  const [current,      setCurrent]     = useState<CurrentData | null>(null)
  const [history,      setHistory]     = useState<HistoryData | null>(null)
  const [logs,         setLogs]        = useState<LogsData | null>(null)
  const [interval,     setIntervalKey]  = useState<IntervalKey>('24h')
  const [loadingMain,  setLoadingMain]  = useState(true)
  const [loadingHist,  setLoadingHist]  = useState(false)
  const [loadingLogs,  setLoadingLogs]  = useState(false)
  const [lastRefresh,  setLastRefresh]  = useState<Date | null>(null)

  const fetchCurrent = useCallback(async () => {
    try {
      const res = await api.get<CurrentData>('/api/server-monitor/current')
      setCurrent(res)
      setLastRefresh(new Date())
    } catch { /* ignore */ }
  }, [])

  const fetchHistory = useCallback(async (iv: IntervalKey) => {
    setLoadingHist(true)
    try {
      const res = await api.get<HistoryData>(`/api/server-monitor/history?interval=${iv}`)
      setHistory(res)
    } catch { /* ignore */ }
    finally { setLoadingHist(false) }
  }, [])

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true)
    try {
      const res = await api.get<LogsData>('/api/server-monitor/logs')
      setLogs(res)
    } catch { /* ignore */ }
    finally { setLoadingLogs(false) }
  }, [])

  // Initial load
  useEffect(() => {
    Promise.all([fetchCurrent(), fetchHistory(interval), fetchLogs()])
      .finally(() => setLoadingMain(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Polling — refresh current every 15s
  useEffect(() => {
    const id = setInterval(() => {
      fetchCurrent()
      fetchLogs()
    }, 15000)
    return () => clearInterval(id)
  }, [fetchCurrent, fetchLogs])

  // Re-fetch history when interval changes
  useEffect(() => {
    fetchHistory(interval)
  }, [interval, fetchHistory])

  const handleRefresh = () => {
    fetchCurrent()
    fetchHistory(interval)
    fetchLogs()
  }

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-white font-semibold text-lg">Server Monitor</h3>
          <p className="text-zinc-500 text-sm">
            VPS-LUX — 173.249.49.92
            {lastRefresh && <span className="ml-2 text-zinc-600">· atualizado {ago(lastRefresh.toISOString())}</span>}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 px-3 py-2 rounded-lg transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loadingMain ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {/* Agent status banner — show when no data */}
      {!current?.server && !loadingMain && (
        <div className="flex items-center gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0" />
          <div>
            <p className="text-yellow-300 text-sm font-medium">Agente de monitorização não detectado</p>
            <p className="text-yellow-500/70 text-xs mt-0.5">
              Instala o agente no VPS-LUX (173.249.49.92) para começar a receber métricas.
              Consulta a documentação em <code className="font-mono">/opt/lux-monitor/monitor.js</code>.
            </p>
          </div>
        </div>
      )}

      <MetricsOverview data={current} loading={loadingMain} />
      <WorkersStatus  workers={current?.workers ?? []} loading={loadingMain} />
      <PipelineHealth data={current} loading={loadingMain} />
      <MetricsCharts  history={history} interval={interval} onInterval={setIntervalKey} loading={loadingHist} />
      <LogsList       logs={logs} loading={loadingLogs} />
    </div>
  )
}
