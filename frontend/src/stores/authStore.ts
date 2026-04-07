import { create } from 'zustand'
import { authApi, type LoginResponse } from '@/lib/api'

interface AuthUser {
  id: string
  email: string
  user_type: string
  comercial_id: string | null
  nome: string | null
}

interface AuthState {
  user: AuthUser | null
  token: string | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  init: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('auth_token'),
  loading: true,

  init: async () => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      set({ loading: false })
      return
    }
    try {
      const user = await authApi.me()
      set({ user, token, loading: false })
    } catch {
      localStorage.removeItem('auth_token')
      set({ user: null, token: null, loading: false })
    }
  },

  login: async (email: string, password: string) => {
    const res: LoginResponse = await authApi.login(email, password)
    localStorage.setItem('auth_token', res.token)
    set({ user: res.user, token: res.token })
  },

  logout: () => {
    localStorage.removeItem('auth_token')
    set({ user: null, token: null })
  },
}))
