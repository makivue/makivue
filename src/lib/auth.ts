const USER_KEY = 'local_studio_profile'
const AUTH_CHANGE = 'local-drama-studio-profile-change'
export const HOME_AUTH_BOOTSTRAP_SCRIPT = "document.currentScript?.parentElement?.setAttribute('data-home-auth','member')"
export type AuthUser = { userId: string; userType: number; reg: boolean; displayName?: string; email?: string; photoURL?: string; isAdmin?: boolean }
const localUser: AuthUser = { userId: '1', userType: 1, reg: false, displayName: '本地工作区', isAdmin: true }
export function getAuthToken(): string | null {
    return typeof window === 'undefined' ? null : 'local-workspace'
}
export function getAuthUser(): AuthUser | null {
    if (typeof window === 'undefined') return null
    try {
        return { ...localUser, ...JSON.parse(localStorage.getItem(USER_KEY) || '{}'), userId: '1', isAdmin: true }
    } catch {
        return { ...localUser }
    }
}
export function getAuthSessionSnapshot(): string {
    if (typeof window === 'undefined') return ''
    try {
        return `local\n${localStorage.getItem(USER_KEY) || ''}`
    } catch {
        return 'local'
    }
}
export function onAuthChange(listener: () => void) {
    if (typeof window === 'undefined') return () => {}
    window.addEventListener(AUTH_CHANGE, listener)
    window.addEventListener('storage', listener)
    return () => {
        window.removeEventListener(AUTH_CHANGE, listener)
        window.removeEventListener('storage', listener)
    }
}
export function setAuthSession(_token: string, user: AuthUser) {
    localStorage.setItem(USER_KEY, JSON.stringify({ displayName: user.displayName, photoURL: user.photoURL }))
    window.dispatchEvent(new Event(AUTH_CHANGE))
}
export function updateAuthUser(patch: Partial<Pick<AuthUser, 'displayName' | 'photoURL'>>) {
    setAuthSession('', { ...localUser, ...getAuthUser(), ...patch })
}
export function clearAuthSession() {
    localStorage.removeItem(USER_KEY)
    window.dispatchEvent(new Event(AUTH_CHANGE))
}
export function isLoggedIn(): boolean {
    return typeof window !== 'undefined'
}
