import { useEffect, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { mapTitle } from '@tile-editor/core'
import { Button, Dialog } from './ui'
import { useEditor } from '../state/store'
import { timeAgo, type Draft } from '../state/drafts'

/**
 * What the last session was in the middle of when it went away. Android kills
 * the Termux process without ceremony, so this is the difference between losing
 * an evening's work and picking it back up.
 */
export function RecoveryDialog() {
  const drafts = useEditor((s) => s.drafts)
  const restoreDraft = useEditor((s) => s.restoreDraft)
  const discardDraft = useEditor((s) => s.discardDraft)
  const status = useEditor((s) => s.status)
  const asked = useEditor((s) => s.dialog === 'drafts')
  const setDialog = useEditor((s) => s.setDialog)
  const [dismissed, setDismissed] = useState(false)
  const [changed, setChanged] = useState<Set<string>>(new Set())

  // A draft is only half the story: the file may have moved on since, and
  // restoring would then quietly undo whatever changed it.
  useEffect(() => {
    let cancelled = false
    const fs = useEditor.getState().fs
    void Promise.all(
      drafts.map(async (draft) => {
        const current = await fs.readText(draft.path).catch(() => draft.baseText)
        return current === draft.baseText ? undefined : draft.key
      }),
    ).then((keys) => {
      if (!cancelled) setChanged(new Set(keys.filter((key): key is string => key !== undefined)))
    })
    return () => {
      cancelled = true
    }
  }, [drafts])

  const close = () => {
    setDismissed(true)
    if (asked) setDialog(null)
  }

  // It opens itself once per session when there is something to recover, and
  // on demand from the command palette after that.
  if (status !== 'ready' || (!asked && (drafts.length === 0 || dismissed))) return null

  if (drafts.length === 0) {
    return (
      <Dialog open onClose={close} title="Niezapisane zmiany" footer={<Button variant="outline" onClick={close}>Zamknij</Button>}>
        <p className="px-4 py-3 text-[12px] text-ink-dim">Nie ma nic do odzyskania — wszystko jest zapisane.</p>
      </Dialog>
    )
  }

  return (
    <Dialog
      open
      onClose={close}
      title={drafts.length === 1 ? 'Niezapisane zmiany' : `Niezapisane zmiany · ${drafts.length}`}
      footer={
        <Button variant="outline" onClick={close}>
          Później
        </Button>
      }
    >
      <p className="px-4 pb-2 text-[12px] text-ink-dim">
        Poprzednia sesja skończyła się bez zapisu. Przywrócenie wkłada zmiany z powrotem do
        edytora — na dysk trafią dopiero, gdy zapiszesz.
      </p>
      <ul className="flex flex-col divide-y divide-line/60">
        {drafts.map((draft) => (
          <DraftRow
            key={draft.key}
            draft={draft}
            fileChanged={changed.has(draft.key)}
            onRestore={() => {
              close()
              void restoreDraft(draft)
            }}
            onDiscard={() => void discardDraft(draft)}
          />
        ))}
      </ul>
    </Dialog>
  )
}

function DraftRow({ draft, fileChanged, onRestore, onDiscard }: {
  draft: Draft
  fileChanged: boolean
  onRestore: () => void
  onDiscard: () => void
}) {
  return (
    <li className="flex items-center gap-2 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink" title={draft.path}>
          {mapTitle(draft.path)}
        </p>
        <p className="text-[11px] text-ink-faint">
          {timeAgo(draft.savedAt)}
          {draft.tilesets.length > 0
            ? ` · z ${draft.tilesets.length} ${draft.tilesets.length === 1 ? 'tilesetem' : 'tilesetami'}`
            : ''}
        </p>
        {fileChanged ? (
          <p className="text-[11px] text-warn">Plik na dysku zmienił się od tego czasu.</p>
        ) : null}
      </div>
      <Button size="sm" variant="outline" onClick={onRestore} title="Przywróć do edytora">
        <RotateCcw size={14} />
        <span className="ml-1">Przywróć</span>
      </Button>
      <button
        type="button"
        className="hit shrink-0 px-1 text-ink-faint hover:text-danger"
        title="Odrzuć szkic"
        aria-label={`Odrzuć szkic ${mapTitle(draft.path)}`}
        onClick={onDiscard}
      >
        <Trash2 size={14} />
      </button>
    </li>
  )
}
