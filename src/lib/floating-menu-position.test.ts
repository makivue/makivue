import { describe, expect, it } from 'vitest'
import { calculateFloatingMenuPosition } from './floating-menu-position'

describe('calculateFloatingMenuPosition', () => {
    it('places a short upward-opening menu directly above its trigger', () => {
        const result = calculateFloatingMenuPosition({
            trigger: { left: 760, top: 950, bottom: 1006, width: 330 },
            menuHeight: 176,
            viewportWidth: 2048,
            viewportHeight: 1080
        })

        expect(result.top).toBe(768)
        expect(result.width).toBe(330)
    })

    it('opens below when there is enough room', () => {
        const result = calculateFloatingMenuPosition({
            trigger: { left: 100, top: 100, bottom: 150, width: 200 },
            menuHeight: 176,
            viewportWidth: 1280,
            viewportHeight: 800
        })

        expect(result.top).toBe(156)
        expect(result.width).toBe(240)
    })

    it('keeps the menu inside the horizontal viewport padding', () => {
        const result = calculateFloatingMenuPosition({
            trigger: { left: 1180, top: 100, bottom: 150, width: 220 },
            menuHeight: 176,
            viewportWidth: 1280,
            viewportHeight: 800
        })

        expect(result.left).toBe(1032)
    })
})
