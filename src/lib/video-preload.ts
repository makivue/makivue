type PreloadMode = 'metadata' | 'auto'
type PreloadJob = {
    video: HTMLVideoElement
    mode: PreloadMode
    cancel: () => void
    finish?: () => void
}

const BUFFER_SECONDS = 3
const PRELOAD_TIMEOUT_MS = 12_000

function hasInitialBuffer(video: HTMLVideoElement): boolean {
    const target = Math.min(BUFFER_SECONDS, Number.isFinite(video.duration) ? video.duration : BUFFER_SECONDS)
    for (let index = 0; index < video.buffered.length; index += 1) {
        if (video.buffered.start(index) <= 0.1 && video.buffered.end(index) >= target) return true
    }
    return false
}

/** Share the speculative buffering budget across every player on the page. */
export function createVideoPreloadScheduler(concurrency = 2) {
    const jobs = new Map<HTMLVideoElement, PreloadJob>()
    const queue: PreloadJob[] = []
    let active = 0

    function drain() {
        while (active < concurrency && queue.length) {
            const job = queue.shift()!
            const { video } = job
            active += 1
            let finished = false
            const finish = () => {
                if (finished) return
                finished = true
                clearTimeout(timeout)
                for (const event of events) video.removeEventListener(event, check)
                // preload is a browser hint, not a byte limit. Never reload or
                // detach the source: that would discard the buffer or interrupt playback.
                if (video.paused && !video.autoplay) video.preload = 'metadata'
                jobs.delete(video)
                active -= 1
                drain()
            }
            const check = () => {
                if (video.error || !video.paused || (job.mode === 'metadata' ? video.readyState >= 1 : hasInitialBuffer(video))) finish()
            }
            const events = ['loadedmetadata', 'loadeddata', 'progress', 'canplay', 'playing', 'error']
            const timeout = setTimeout(finish, PRELOAD_TIMEOUT_MS)
            job.finish = finish
            for (const event of events) video.addEventListener(event, check)
            video.preload = job.mode
            check()
        }
    }

    return {
        request(video: HTMLVideoElement, mode: PreloadMode, priority = false): () => void {
            const existing = jobs.get(video)
            if (existing) {
                if (priority) {
                    existing.mode = mode
                    if (existing.finish) video.preload = mode
                    else {
                        queue.splice(queue.indexOf(existing), 1)
                        queue.unshift(existing)
                    }
                }
                return existing.cancel
            }
            if (!video.paused || video.autoplay) {
                video.preload = mode
                return () => {}
            }
            if (video.error || (mode === 'metadata' ? video.readyState >= 1 : hasInitialBuffer(video))) return () => {}
            const job: PreloadJob = {
                video,
                mode,
                cancel: () => {
                    if (jobs.get(video) !== job) return
                    if (job.finish) job.finish()
                    else {
                        queue.splice(queue.indexOf(job), 1)
                        jobs.delete(video)
                    }
                }
            }
            jobs.set(video, job)
            if (priority) queue.unshift(job)
            else queue.push(job)
            drain()
            return job.cancel
        }
    }
}

export const videoPreloadScheduler = createVideoPreloadScheduler()
