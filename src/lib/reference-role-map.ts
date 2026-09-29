export type ImageReferenceRole = {
    url?: string | null
    description: string
}

function compactDescription(value: string) {
    return value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 320)
}

/**
 * Image APIs receive an ordered list of references, but a bare list does not
 * tell the model which person or production concern each image owns. Build an
 * explicit, 1-based role map while preserving the exact provider image order.
 */
export function buildImageReferenceRoleMap(referenceImages: string[], roles: ImageReferenceRole[]) {
    const descriptionsByNumber = new Map<number, string[]>()

    for (const role of roles) {
        const url = role.url?.trim()
        const description = compactDescription(role.description)
        if (!url || !description) continue
        const index = referenceImages.indexOf(url)
        if (index < 0) continue
        const number = index + 1
        const descriptions = descriptionsByNumber.get(number) ?? []
        if (!descriptions.includes(description)) descriptions.push(description)
        descriptionsByNumber.set(number, descriptions)
    }

    if (descriptionsByNumber.size === 0) return ''
    const lines = [...descriptionsByNumber.entries()]
        .sort(([left], [right]) => left - right)
        .map(([number, descriptions]) => `- reference image #${number}: ${descriptions.join('; ')}`)

    return [
        'REFERENCE ROLE MAP (authoritative; never swap identities or copy content from the wrong role):',
        ...lines,
        'Use every image only for its assigned role. A style reference never supplies a person, wardrobe, prop, scene layout, pose, or composition; a scene reference never supplies a person.'
    ].join('\n')
}
