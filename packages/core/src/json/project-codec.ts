import type { TiledProject } from '../model.js'
import { emitOrdered, takePreserved } from './common.js'
import { PROJECT_STYLE, writeJson } from './writer.js'

const PROJECT_KEYS = ['folders', 'automappingRulesFile', 'commands', 'extensionsPath', 'propertyTypes'] as const

export function parseProjectJson(text: string): TiledProject {
  const raw = JSON.parse(text) as Record<string, unknown>
  return {
    folders: Array.isArray(raw.folders) ? raw.folders.map(String) : ['.'],
    automappingRulesFile: raw.automappingRulesFile as string | undefined,
    commands: raw.commands as unknown[] | undefined,
    extensionsPath: raw.extensionsPath as string | undefined,
    propertyTypes: raw.propertyTypes as unknown[] | undefined,
    ...takePreserved(raw, PROJECT_KEYS),
  }
}

export function serializeProjectJson(project: TiledProject): string {
  const out = emitOrdered(project, {
    automappingRulesFile: project.automappingRulesFile ?? '',
    commands: project.commands ?? [],
    extensionsPath: project.extensionsPath ?? 'extensions',
    folders: project.folders,
    propertyTypes: project.propertyTypes ?? [],
  })
  return writeJson(out, PROJECT_STYLE)
}
