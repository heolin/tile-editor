import type { TiledProject } from '../model.js'
import { parsePropertyTypes, serializePropertyTypes, unrecognizedPropertyTypes } from '../property-types.js'
import { DEFAULT_PROJECT_HINTS, detectProjectHints, emitOrdered, takePreserved, type ProjectFormatHints } from './common.js'
import { PROJECT_STYLE, writeJson } from './writer.js'

const PROJECT_KEYS = ['folders', 'automappingRulesFile', 'commands', 'extensionsPath', 'propertyTypes'] as const

export function parseProjectJson(text: string): TiledProject {
  const raw = JSON.parse(text) as Record<string, unknown>
  return {
    formatHints: detectProjectHints(text),
    folders: Array.isArray(raw.folders) ? raw.folders.map(String) : ['.'],
    automappingRulesFile: raw.automappingRulesFile as string | undefined,
    commands: raw.commands as unknown[] | undefined,
    extensionsPath: raw.extensionsPath as string | undefined,
    propertyTypes: parsePropertyTypes(raw.propertyTypes),
    unknownPropertyTypes: unrecognizedPropertyTypes(raw.propertyTypes),
    ...takePreserved(raw, PROJECT_KEYS),
  }
}

export function serializeProjectJson(project: TiledProject, hints?: ProjectFormatHints): string {
  const layout = hints ?? project.formatHints ?? DEFAULT_PROJECT_HINTS
  const out = emitOrdered(project, {
    automappingRulesFile: project.automappingRulesFile ?? '',
    commands: project.commands ?? [],
    extensionsPath: project.extensionsPath ?? 'extensions',
    folders: project.folders,
    propertyTypes: [...serializePropertyTypes(project.propertyTypes), ...(project.unknownPropertyTypes ?? [])],
  })
  return writeJson(out, {
    ...PROJECT_STYLE,
    objectIndent: layout.indent,
    arrayIndent: layout.indent,
    breakEmptyArrays: layout.breakEmptyArrays,
    trailingNewline: layout.trailingNewline,
  })
}
