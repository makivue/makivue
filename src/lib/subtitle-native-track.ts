import type { SubtitleCue } from './subtitle-playback'

/** Keep parsed cues attached after the native track finishes its initial load. */
export function bindNativeSubtitleCues(element: HTMLTrackElement, cues: SubtitleCue[]): () => void {
    const attached: VTTCue[] = []
    const clear = () => {
        for (const cue of attached) {
            if (cue.track === element.track) element.track.removeCue(cue)
        }
        attached.length = 0
    }
    const install = () => {
        clear()
        // Adding before LOADED lets the browser's initial load erase the cues.
        if (element.readyState !== 2) return
        for (const { start, end, text } of cues) {
            const cue = new VTTCue(start, end, text)
            element.track.addCue(cue)
            attached.push(cue)
        }
    }
    element.addEventListener('load', install)
    install()
    return () => {
        element.removeEventListener('load', install)
        clear()
    }
}
