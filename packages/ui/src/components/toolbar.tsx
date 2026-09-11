import clsx from 'clsx'
import {
  Brush, Eraser, Grid3x3, PaintBucket, Pipette, Play, Redo2, Save, Shapes,
  Square, SquareDashed, MousePointer2, StickyNote, Undo2,
} from 'lucide-react'
import { Button } from './ui'
import { useEditor, type ToolId } from '../state/store'

const TILE_TOOLS: { id: ToolId; icon: typeof Brush; label: string; key: string }[] = [
  { id: 'brush', icon: Brush, label: 'Pędzel', key: 'B' },
  { id: 'eraser', icon: Eraser, label: 'Gumka', key: 'E' },
  { id: 'fill', icon: PaintBucket, label: 'Wypełnienie', key: 'F' },
  { id: 'rect', icon: Square, label: 'Prostokąt', key: 'R' },
  { id: 'picker', icon: Pipette, label: 'Pipeta', key: 'I' },
  { id: 'area', icon: SquareDashed, label: 'Zaznacz obszar', key: 'S' },
]

export function ToolBar() {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const layer = useEditor((s) => s.activeLayer())
  const isObjectLayer = layer?.kind === 'objectgroup'

  return (
    <div className="flex items-center gap-0.5">
      {TILE_TOOLS.map(({ id, icon: Icon, label, key }) => (
        <Button
          key={id}
          active={tool === id}
          disabled={isObjectLayer}
          title={`${label} (${key})`}
          aria-label={label}
          onClick={() => setTool(id)}
        >
          <Icon size={16} />
        </Button>
      ))}
      <span className="mx-1 h-5 w-px bg-line" />
      <Button
        active={tool === 'select'}
        disabled={!isObjectLayer}
        title="Zaznaczanie obiektów (V)"
        aria-label="Zaznaczanie obiektów"
        onClick={() => setTool('select')}
      >
        <MousePointer2 size={16} />
      </Button>
      <Button
        active={tool === 'object'}
        disabled={!isObjectLayer}
        title="Stawianie obiektów (A)"
        aria-label="Stawianie obiektów"
        onClick={() => setTool('object')}
      >
        <StickyNote size={16} />
      </Button>
    </div>
  )
}

export function ViewControls() {
  const showGrid = useEditor((s) => s.showGrid)
  const showObjects = useEditor((s) => s.showObjects)
  const animate = useEditor((s) => s.animate)
  const toggleGrid = useEditor((s) => s.toggleGrid)
  const toggleObjects = useEditor((s) => s.toggleObjects)
  const toggleAnimate = useEditor((s) => s.toggleAnimate)
  return (
    <div className="flex items-center gap-0.5">
      <Button active={showGrid} onClick={toggleGrid} title="Siatka (G)" aria-label="Siatka">
        <Grid3x3 size={16} />
      </Button>
      <Button active={showObjects} onClick={toggleObjects} title="Obiekty (O)" aria-label="Obiekty">
        <Shapes size={16} />
      </Button>
      <Button
        active={animate}
        onClick={toggleAnimate}
        title="Odtwarzaj animacje kafli (P) — rysuje w sposób ciągły"
        aria-label="Animacje"
      >
        <Play size={16} />
      </Button>
    </div>
  )
}

export function HistoryControls() {
  const history = useEditor((s) => s.history)
  useEditor((s) => s.revision)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const save = useEditor((s) => s.save)
  const dirty = useEditor((s) => s.dirty)
  const saving = useEditor((s) => s.saving)

  return (
    <div className="flex items-center gap-0.5">
      <Button onClick={undo} disabled={!history.canUndo} title={history.undoLabel ? `Cofnij: ${history.undoLabel}` : 'Cofnij'} aria-label="Cofnij">
        <Undo2 size={16} />
      </Button>
      <Button onClick={redo} disabled={!history.canRedo} title={history.redoLabel ? `Ponów: ${history.redoLabel}` : 'Ponów'} aria-label="Ponów">
        <Redo2 size={16} />
      </Button>
      <Button
        variant={dirty ? 'solid' : 'ghost'}
        onClick={() => void save()}
        disabled={!dirty || saving}
        title="Zapisz (Ctrl+S)"
        className={clsx(dirty && 'font-semibold')}
      >
        <Save size={16} />
        <span className="hidden md:inline">{saving ? 'Zapis…' : dirty ? 'Zapisz' : 'Zapisano'}</span>
      </Button>
    </div>
  )
}
