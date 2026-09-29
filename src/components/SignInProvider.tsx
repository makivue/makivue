'use client'
import type { ReactNode } from 'react'
const localSession = async () => true
export default function SignInProvider({ children }: { children: ReactNode }) {
    return children
}
export function useSignIn() {
    return localSession
}
