import path from 'node:path'

export function localDataDirectory() {
    return path.resolve(process.env.LOCAL_DATA_DIR?.trim() || path.join(process.cwd(), 'data'))
}

export function localMediaDirectory() {
    return path.join(localDataDirectory(), 'media')
}
