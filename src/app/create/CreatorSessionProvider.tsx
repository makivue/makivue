'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { getAuthUser, isLoggedIn, onAuthChange } from '@/lib/auth'
import { createCreatorSessions, removeCreatorAssets, updateCreatorSession, type CreatorSession, type Mode } from './creator-session'

type SetField = <K extends keyof CreatorSession>(mode: Mode, key: K, update: SetStateAction<CreatorSession[K]>) => void
const CreatorSessionContext = createContext<{ sessions: Record<Mode, CreatorSession>; setField: SetField; removeAssets: (assetIds: readonly string[]) => void } | null>(null)

// The shared layout stays mounted across image/video navigation. Each async
// callback keeps a setter bound to its original mode, including after navigation.
export default function CreatorSessionProvider({ children }: { children: ReactNode }) {
    const [sessions, setSessions] = useState(createCreatorSessions)
    const [accountEpoch, setAccountEpoch] = useState(0)
    const activeEpochRef = useRef(0)
    useEffect(() => {
        let ownerId = isLoggedIn() ? getAuthUser()?.userId : null
        return onAuthChange(() => {
            const nextOwnerId = isLoggedIn() ? getAuthUser()?.userId : null
            // Preserve a guest draft on login, but discard the previous account's
            // media on logout/account switch, including late async completions.
            if (ownerId && ownerId !== nextOwnerId) {
                activeEpochRef.current += 1
                setAccountEpoch(activeEpochRef.current)
                setSessions(createCreatorSessions())
            }
            ownerId = nextOwnerId
        })
    }, [])
    const setField = useCallback<SetField>(
        (mode, key, update) => {
            if (activeEpochRef.current !== accountEpoch) return
            setSessions(current => updateCreatorSession(current, mode, key, update))
        },
        [accountEpoch]
    )
    const removeAssets = useCallback(
        (assetIds: readonly string[]) => {
            if (activeEpochRef.current !== accountEpoch) return
            setSessions(current => removeCreatorAssets(current, assetIds))
        },
        [accountEpoch]
    )
    const value = useMemo(() => ({ sessions, setField, removeAssets }), [sessions, setField, removeAssets])
    return <CreatorSessionContext.Provider value={value}>{children}</CreatorSessionContext.Provider>
}

export function useRemoveCreatorAssets() {
    const context = useContext(CreatorSessionContext)
    if (!context) throw new Error('MISSING_CREATOR_SESSION_PROVIDER')
    return context.removeAssets
}

export function useCreatorState<K extends keyof CreatorSession>(mode: Mode, key: K): [CreatorSession[K], Dispatch<SetStateAction<CreatorSession[K]>>] {
    const context = useContext(CreatorSessionContext)
    if (!context) throw new Error('MISSING_CREATOR_SESSION_PROVIDER')
    const { sessions, setField } = context
    const setValue = useCallback((update: SetStateAction<CreatorSession[K]>) => setField(mode, key, update), [setField, mode, key])
    return [sessions[mode][key], setValue]
}
