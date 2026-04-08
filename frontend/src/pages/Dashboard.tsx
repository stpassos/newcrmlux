import { Building2, Users, LayoutDashboard, FolderSync } from 'lucide-react'

export default function Dashboard() {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-white">Dashboard</h2>
        <p className="text-zinc-500 text-sm mt-1">Bem-vindo ao painel de administração</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Imóveis" value="—" icon={<Building2 className="w-5 h-5" />} />
        <StatCard label="Utilizadores" value="—" icon={<Users className="w-5 h-5" />} />
        <StatCard label="Leads" value="—" icon={<LayoutDashboard className="w-5 h-5" />} />
        <StatCard label="Sincronizações" value="—" icon={<FolderSync className="w-5 h-5" />} />
      </div>

      <div className="mt-8 bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <p className="text-zinc-400 text-sm">
          O painel de administração está em desenvolvimento. As funcionalidades serão adicionadas progressivamente.
        </p>
      </div>
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-zinc-500 text-sm">{label}</span>
        <div className="text-zinc-600">{icon}</div>
      </div>
      <p className="text-2xl font-semibold text-white">{value}</p>
    </div>
  )
}
