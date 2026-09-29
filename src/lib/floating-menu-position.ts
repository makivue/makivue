export interface FloatingMenuTriggerRect {
    left: number
    top: number
    bottom: number
    width: number
}

export interface FloatingMenuPosition {
    left: number
    top: number
    width: number
    maxHeight: number
}

export function calculateFloatingMenuPosition({
    trigger,
    menuHeight,
    viewportWidth,
    viewportHeight,
    minimumWidth = 240,
    maximumHeight = 420,
    gap = 6,
    viewportPadding = 8
}: {
    trigger: FloatingMenuTriggerRect
    menuHeight: number
    viewportWidth: number
    viewportHeight: number
    minimumWidth?: number
    maximumHeight?: number
    gap?: number
    viewportPadding?: number
}): FloatingMenuPosition {
    const viewportContentWidth = Math.max(1, viewportWidth - viewportPadding * 2)
    const width = Math.min(Math.max(trigger.width, minimumWidth), viewportContentWidth)
    const left = Math.min(
        Math.max(viewportPadding, trigger.left),
        Math.max(viewportPadding, viewportWidth - width - viewportPadding)
    )
    const availableBelow = Math.max(0, viewportHeight - trigger.bottom - gap - viewportPadding)
    const availableAbove = Math.max(0, trigger.top - gap - viewportPadding)
    const desiredHeight = Math.min(menuHeight || 220, maximumHeight)
    const opensUp = availableBelow < desiredHeight && availableAbove > availableBelow
    const availableHeight = opensUp ? availableAbove : availableBelow
    const maxHeight = Math.max(1, Math.min(maximumHeight, availableHeight))
    const renderedHeight = Math.min(desiredHeight, maxHeight)
    const top = opensUp
        ? Math.max(viewportPadding, trigger.top - gap - renderedHeight)
        : Math.min(trigger.bottom + gap, viewportHeight - viewportPadding - renderedHeight)

    return { left, top, width, maxHeight }
}
