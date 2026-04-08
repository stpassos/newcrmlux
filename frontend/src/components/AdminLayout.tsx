import { useAuthStore } from '@/stores/authStore'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { LogOut, LayoutDashboard, Users, Building2, FolderSync } from 'lucide-react'

const NAV = [
  { path: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { path: '/admin/imoveis', label: 'Imóveis', icon: Building2 },
  { path: '/admin/utilizadores', label: 'Utilizadores', icon: Users },
  { path: '/admin/sincronizacao', label: 'Sincronização', icon: FolderSync },
]

export default function AdminLayout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const isActive = (path: string, exact?: boolean) =>
    exact ? location.pathname === path : location.pathname.startsWith(path)

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-60 bg-zinc-900 border-r border-zinc-800 flex flex-col z-10">
        <div className="px-6 py-6 border-b border-zinc-800">
          <h1 className="text-lg font-semibold text-white">ImoDigital</h1>
          <p className="text-xs text-zinc-500 mt-0.5">CRM Imobiliário</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(item => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                isActive(item.path, item.exact)
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-500 hover:text-white hover:bg-zinc-800/60'
              }`}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {item.label}
            </button>
          ))}
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

      {/* Content */}
      <main className="ml-60 flex-1 min-h-screen">
        <Outlet />
      </main>
    </div>
  )
}
