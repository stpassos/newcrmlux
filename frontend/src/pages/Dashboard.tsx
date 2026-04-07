import { useAuthStore } from '@/stores/authStore'
import { useNavigate } from 'react-router-dom'
import { LogOut, LayoutDashboard, Users, Building2, FolderSync } from 'lucide-react'

export default function Dashboard() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-60 bg-zinc-900 border-r border-zinc-800 flex flex-col">
        <div className="px-6 py-6 border-b border-zinc-800">
          <h1 className="text-lg font-semibold text-white">ImoDigital</h1>
          <p className="text-xs text-zinc-500 mt-0.5">CRM Imobiliário</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavItem icon={<LayoutDashboard className="w-4 h-4" />} label="Dashboard" active />
          <NavItem icon={<Building2 className="w-4 h-4" />} label="Imóveis" />
          <NavItem icon={<Users className="w-4 h-4" />} label="Utilizadores" />
          <NavItem icon={<FolderSync className="w-4 h-4" />} label="Sincronização" />
        </nav>

        <div className="px-3 py-4 border-t border-zinc-800">
          <div className="px-3 py-2 mb-2">
            <p className="text-xs font-medium text-white truncate">{user?.nome || user?.email}</p>
            <p className="text-xs text-zinc-500 truncate">{user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Terminar sessão
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="ml-60 p-8">
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
      </main>
    </div>
  )
}

function NavItem({ icon, label, active }: { icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${
        active
          ? 'bg-zinc-800 text-white'
          : 'text-zinc-500 hover:text-white hover:bg-zinc-800/60'
      }`}
    >
      {icon}
      {label}
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
