import path from 'path'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import type { WorkflowStageKey } from './workflow'

export interface ProjectSkillManifestEntry {
    id: string
    label: string
    stageKeys: WorkflowStageKey[]
    path: string
}

interface ProjectSkillReference {
    name: string
    url: string
    usedFor: string
}

export interface ProjectSkillManifest {
    version: number
    updated: string
    purpose: string
    externalReferences: ProjectSkillReference[]
    skills: ProjectSkillManifestEntry[]
}

export interface ProjectSkill extends ProjectSkillManifestEntry {
    content: string
}

// Anchor every read to <repo>/skills so Turbopack's file tracer can scope the
// runtime deps to that subfolder instead of the whole project.
const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills')
const MANIFEST_PATH = path.join(SKILLS_DIR, 'manifest.json')

// Manifest paths are stored as `skills/<id>/SKILL.md`. Strip the leading
// `skills/` so we can safely path.join against SKILLS_DIR.
function resolveSkillFile(entryPath: string): string {
    const relative = entryPath.replace(/^skills\//, '')
    return path.join(SKILLS_DIR, relative)
}

export async function getProjectSkillManifest(): Promise<ProjectSkillManifest> {
    const raw = await readFile(MANIFEST_PATH, 'utf8')
    return JSON.parse(raw) as ProjectSkillManifest
}

export async function listProjectSkills(stage?: WorkflowStageKey): Promise<ProjectSkillManifestEntry[]> {
    const manifest = await getProjectSkillManifest()
    if (!stage) return manifest.skills
    return manifest.skills.filter(skill => skill.stageKeys.includes(stage))
}

export async function getProjectSkill(id: string): Promise<ProjectSkill | null> {
    const manifest = await getProjectSkillManifest()
    const entry = manifest.skills.find(skill => skill.id === id)
    if (!entry) return null
    const content = await readFile(resolveSkillFile(entry.path), 'utf8')
    return { ...entry, content }
}

export async function getProjectSkillsForStage(stage: WorkflowStageKey): Promise<ProjectSkill[]> {
    const entries = await listProjectSkills(stage)
    const skills = await Promise.all(entries.map(entry => getProjectSkill(entry.id)))
    return skills.filter(Boolean) as ProjectSkill[]
}
