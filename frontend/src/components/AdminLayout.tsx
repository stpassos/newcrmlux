import { useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { LogOut, LayoutDashboard, Users, Building2, FolderSync, Menu, X } from 'lucide-react'

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
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const handleNav = (path: string) => {
    navigate(path)
    setSidebarOpen(false)
  }

  const isActive = (path: string, exact?: boolean) =>
    exact ? location.pathname === path : location.pathname.startsWith(path)

  const sidebarContent = (
    <>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map(item => (
          <button
            key={item.path}
            onClick={() => handleNav(item.path)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left min-h-[44px] ${
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

      <div className="px-3 py-4 border-t border-zinc-800 safe-bottom">
        <div className="px-3 py-2 mb-2">
          <p className="text-xs font-medium text-white truncate">{user?.nome || user?.email}</p>
          <p className="text-xs text-zinc-500 truncate">{user?.email}</p>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors min-h-[44px]"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Terminar sessão
        </button>
      </div>
    </>
  )

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — drawer on mobile, fixed on desktop */}
      <aside
        className={`
          fixed left-0 top-0 h-full w-64 bg-zinc-900 border-r border-zinc-800
          flex flex-col z-30
          transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0
        `}
        aria-label="Navegação principal"
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800 min-h-[64px]">
          <div>
            <h1 className="text-lg font-semibold text-white">ImoDigital</h1>
            <p className="text-xs text-zinc-500 mt-0.5">CRM Imobiliário</p>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1.5 text-zinc-500 hover:text-white transition-colors rounded-lg hover:bg-zinc-800"
            aria-label="Fechar menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {sidebarContent}
      </aside>

      {/* Main content area */}
      <main className="flex-1 min-h-screen min-w-0 overflow-x-hidden lg:ml-64">
        {/* Mobile top bar */}
        <div className="lg:hidden sticky top-0 z-10 flex items-center gap-3 px-4 min-h-[56px] bg-zinc-900 border-b border-zinc-800">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-1 text-zinc-400 hover:text-white transition-colors rounded-lg hover:bg-zinc-800 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Abrir menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-white font-semibold text-sm">ImoDigital</span>
        </div>

        <Outlet />
      </main>
    </div>
  )
}
