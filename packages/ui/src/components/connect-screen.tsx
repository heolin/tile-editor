import { useState } from 'react'
import { Plug, ServerCrash } from 'lucide-react'
import { Button, TextInput } from './ui'
import { needsExplicitServer, storedServerBase } from '../fs/http-fs'
import { useEditor } from '../state/store'

const SUGGESTIONS = ['http://127.0.0.1:4173', 'http://localhost:4173']

/**
 * Shown when the editor cannot reach a project server. In a browser served by
 * that server this is a plain error; in a packaged app there is no server on
 * the same origin, so an address has to be entered once and is remembered.
 */
export function ConnectScreen({ error }: { error?: string }) {
  const connectTo = useEditor((s) => s.connectTo)
  const packaged = needsExplicitServer()
  const [address, setAddress] = useState(storedServerBase() || SUGGESTIONS[0]!)
  const [busy, setBusy] = useState(false)

  const connect = async (value: string) => {
    setBusy(true)
    await connectTo(value.replace(/\/$/, ''))
    setBusy(false)
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-4">
        <div className="flex items-center gap-3">
          <ServerCrash size={22} className="shrink-0 text-warn" />
          <h1 className="text-[17px] font-semibold">
            {packaged ? 'Wskaż serwer projektu' : 'Nie udało się otworzyć projektu'}
          </h1>
        </div>

        <p className="text-[13px] leading-relaxed text-ink-dim">
          {packaged ? (
            <>
              Edytor rysuje mapy, ale pliki czyta serwer uruchomiony obok — zwykle w Termuxie na
              tym samym urządzeniu. Uruchom w folderze projektu:
            </>
          ) : (
            <>Serwer nie odpowiada. Uruchom go w folderze projektu:</>
          )}
        </p>

        <code className="rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-accent-ink">
          npx tile-editor .
        </code>

        {error ? (
          <p className="rounded-md border border-danger/40 bg-danger-deep px-3 py-2 text-[12px] text-danger">{error}</p>
        ) : null}

        <div className="flex flex-col gap-2">
          <label className="text-[11px] font-medium tracking-wide text-ink-faint" htmlFor="server-address">
            Adres serwera
          </label>
          <div className="flex gap-2">
            <TextInput
              id="server-address"
              value={address}
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void connect(address)
              }}
            />
            <Button variant="solid" disabled={busy} onClick={() => void connect(address)} className="shrink-0">
              <Plug size={15} />
              {busy ? 'Łączę…' : 'Połącz'}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((suggestion) => (
              <Button key={suggestion} size="sm" variant="outline" onClick={() => setAddress(suggestion)}>
                {suggestion}
              </Button>
            ))}
            {!packaged ? (
              <Button size="sm" variant="outline" onClick={() => void connect('')}>
                ten sam adres co strona
              </Button>
            ) : null}
          </div>
        </div>

        <p className="text-[11.5px] leading-relaxed text-ink-faint">
          Serwer nasłuchuje na 127.0.0.1. Żeby połączyć się z innego urządzenia w tej samej sieci,
          uruchom go z <code className="text-ink-dim">--lan</code> i wpisz tu adres IP telefonu.
        </p>
      </div>
    </div>
  )
}
