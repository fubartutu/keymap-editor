import { buildRegistry, type BehaviorRegistry } from '../core/behaviors.ts'
import type { DescribeCtx } from '../core/describe.ts'
import { getLayers, layerDefines, type LayerInfo } from '../core/keymap.ts'
import type { Project } from '../core/project.ts'

/** Derived data most components need, computed once per project state. */
export interface Ctx {
  project: Project
  reg: BehaviorRegistry
  layers: LayerInfo[]
  defines: Map<string, number>
  describe: DescribeCtx
}

const cache = new WeakMap<Project, Ctx>()

export function makeCtx(project: Project): Ctx {
  let c = cache.get(project)
  if (!c) {
    const reg = buildRegistry(project.keymap)
    const layers = getLayers(project.keymap)
    const defines = layerDefines(project.keymap)
    c = { project, reg, layers, defines, describe: { file: project.keymap, reg, layers, defines, os: project.meta.os } }
    cache.set(project, c)
  }
  return c
}
