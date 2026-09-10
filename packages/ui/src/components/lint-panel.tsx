import clsx from 'clsx'
import { AlertTriangle, CircleAlert, Info, Play, Wrench } from 'lucide-react'
import type { LintFinding, LintSeverity } from '@tile-editor/core'
import { Button, Empty, Panel } from './ui'
import { useEditor } from '../state/store'

const ICONS: Record<LintSeverity, typeof Info> = {
  error: CircleAlert,
  warning: AlertTriangle,
  info: Info,
}

const TONE: Record<LintSeverity, string> = {
  error: 'text-danger',
  warning: 'text-warn',
  info: 'text-ink-faint',
}

/**
 * The rules here come from defects actually present in examples/: a property
 * used with two types, properties missing from a few maps, tiles nothing places.
 */
export function LintPanel() {
  const findings = useEditor((s) => s.lint)
  const running = useEditor((s) => s.lintRunning)
  const runLint = useEditor((s) => s.runLint)
  const openMap = useEditor((s) => s.openMap)
  const applyFix = useEditor((s) => s.applyLintFix)
  const fixable = findings.filter((f) => f.fix).length

  const counts = findings.reduce<Record<LintSeverity, number>>(
    (acc, f) => ({ ...acc, [f.severity]: acc[f.severity] + 1 }),
    { error: 0, warning: 0, info: 0 },
  )

  return (
    <Panel
      title="Lint"
      actions={
        <Button size="sm" variant="outline" onClick={() => void runLint()} disabled={running}>
          <Play size={12} /> {running ? 'Sprawdzam…' : 'Sprawdź projekt'}
        </Button>
      }
    >
      {findings.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-b border-line px-3 py-2 text-[12px]">
          <span className="text-danger">{counts.error} błędów</span>
          <span className="text-warn">{counts.warning} ostrzeżeń</span>
          <span className="text-ink-faint">{counts.info} uwag</span>
          {fixable > 0 ? (
            <span className="w-full text-[11px] text-accent-ink">
              {fixable} {fixable === 1 ? 'da się naprawić' : 'da się naprawić'} automatycznie
            </span>
          ) : null}
        </div>
      ) : null}

      {findings.length === 0 ? (
        <Empty>
          {running ? 'Sprawdzam wszystkie mapy…' : 'Uruchom sprawdzenie, żeby przejrzeć cały projekt.'}
        </Empty>
      ) : (
        <ul className="divide-y divide-line/60">
          {findings.map((finding, i) => (
            <Row key={i} finding={finding} onOpen={openMap} onFix={applyFix} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

function Row({ finding, onOpen, onFix }: {
  finding: LintFinding
  onOpen: (path: string) => void
  onFix: (fix: NonNullable<LintFinding['fix']>) => void | Promise<void>
}) {
  const Icon = ICONS[finding.severity]
  return (
    <li className="flex gap-2 px-3 py-2">
      <Icon size={14} className={clsx('mt-0.5 shrink-0', TONE[finding.severity])} />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] leading-snug text-ink-dim">{finding.message}</p>
        <p className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
          <code className="rounded bg-ground px-1">{finding.rule}</code>
          {finding.mapPath ? (
            <button type="button" className="truncate underline-offset-2 hover:text-accent hover:underline" onClick={() => onOpen(finding.mapPath!)}>
              {finding.mapPath}
            </button>
          ) : null}
        </p>
        {finding.fix ? (
          <div className="mt-1.5 flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onFix(finding.fix!)}
              title="Zapisuje pliki bezpośrednio — cofniesz to gitem"
            >
              <Wrench size={12} /> Napraw {finding.fix.count} na {finding.fix.to}
            </Button>
            <span className="text-[10.5px] text-ink-faint">zapisuje pliki od razu</span>
          </div>
        ) : null}
      </div>
    </li>
  )
}
