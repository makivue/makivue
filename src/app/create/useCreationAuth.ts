'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getAuthSessionSnapshot, getAuthUser, isLoggedIn, onAuthChange } from '@/lib/auth'
import { useSignIn } from '@/components/SignInProvider'

export function useCreationAuth() {
    const requestSignIn = useSignIn()
    const snapshot = useSyncExternalStore(onAuthChange, getAuthSessionSnapshot, () => '')
    const userId = snapshot && isLoggedIn() ? getAuthUser()!.userId : null
    const [signingIn, setSigningIn] = useState(false)
    const activeRef = useRef(true)
    useEffect(() => {
        activeRef.current = true
        return () => {
            activeRef.current = false
        }
    }, [])

    const requireAuth = useCallback(async () => {
        if (isLoggedIn()) return true
        setSigningIn(true)
        try {
            const authenticated = await requestSignIn()
            // A popup can finish after navigating to a different creator.
            return authenticated && activeRef.current
        } finally {
            setSigningIn(false)
        }
    }, [requestSignIn])

    return { userId, signingIn, requireAuth }
}
