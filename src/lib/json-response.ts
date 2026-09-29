/**
 * Extract complete top-level JSON objects from an LLM response.
 * Handles prose/code fences, braces inside strings, and concatenated objects
 * such as `{"chapters":[...]}{"chapters":[...]}`.
 */
export function extractBalancedJsonObjects(raw: string): string[] {
    const objects: string[] = []
    let start = -1
    let depth = 0
    let inString = false
    let escaped = false

    for (let index = 0; index < raw.length; index += 1) {
        const character = raw[index]

        if (depth === 0) {
            if (character === '{') {
                start = index
                depth = 1
                inString = false
                escaped = false
            }
            continue
        }

        if (escaped) {
            escaped = false
            continue
        }
        if (character === '\\' && inString) {
            escaped = true
            continue
        }
        if (character === '"') {
            inString = !inString
            continue
        }
        if (inString) continue

        if (character === '{') {
            depth += 1
        } else if (character === '}') {
            depth -= 1
            if (depth === 0 && start >= 0) {
                objects.push(raw.slice(start, index + 1))
                start = -1
            }
        }
    }

    return objects
}
