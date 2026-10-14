import { useEffect, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAccess } from '../lib/access'
import { Field, FormAlert } from './ui'
import { Button } from './ui/Button'

/**
 * Profile → PTCG Live name (migration 086).
 *
 * A pasted PTCG Live log names both players but not which one is the reader, so DeckPal guessed from the deck's cards
 * and sometimes guessed the opponent. With the name set, a log that contains it is read from the reader's side. While
 * it is empty it fills itself in after three logged games under the same name; it is never changed automatically once
 * set, and a typed name is the reader's to change or clear here.
 */
export function PtcglName() {
  const access = useAccess()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['settings', access.identity],
    queryFn: ({ signal }) => api.settings(signal),
    enabled: access.ready && !!access.identity,
    retry: false,
    gcTime: 0,
  })
  const stored = query.data?.settings?.ptcglName ?? null
  const source = query.data?.settings?.ptcglNameSource ?? null
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    setDraft(stored ?? '')
  }, [stored])

  const save = async (name: string | null) => {
    setSaving(true)
    setError('')
    setSaved('')
    try {
      await api.updateSettings({ ptcglName: name })
      await client.invalidateQueries({ queryKey: ['settings', access.identity] })
      setSaved(name ? 'Saved.' : 'Cleared.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your PTCG Live name.')
    } finally {
      setSaving(false)
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const name = draft.trim()
    if (name.length > 100) {
      setError('A PTCG Live name is at most 100 characters.')
      return
    }
    void save(name || null)
  }

  const unchanged = draft.trim() === (stored ?? '')
  return (
    <section id="ptcgl-name" className="scroll-mt-[90px] space-y-[12px] rounded-2xl bg-surface-secondary p-[20px]">
      <h2 className="font-display text-[22px] text-text-primary">PTCG Live name</h2>
      <p className="text-[14px] text-text-muted">
        Deck-E and connected AI apps use this to tell which player in a pasted battle log is you. Leave it empty and it
        fills in by itself after you log three games under the same name.
      </p>
      <form onSubmit={onSubmit} noValidate>
        <Field
          label="Your PTCG Live screen name"
          name="ptcglName"
          autoComplete="off"
          spellCheck={false}
          maxLength={100}
          value={draft}
          disabled={!query.data || saving}
          onChange={(event) => {
            setDraft(event.target.value)
            setSaved('')
          }}
          hint={source === 'auto' && unchanged ? 'Filled in from your logged games. Change it if it’s wrong.' : undefined}
        />
        <div className="flex flex-wrap items-center gap-[12px]">
          <Button type="submit" size="sm" loading={saving} disabled={!query.data || unchanged}>
            Save name
          </Button>
          {stored && (
            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void save(null)}>
              Clear
            </Button>
          )}
          {saved && (
            <span role="status" className="text-[14px] text-text-muted">
              {saved}
            </span>
          )}
        </div>
      </form>
      {query.isPending && <p role="status">Loading your PTCG Live name…</p>}
      {(error || query.error) && <FormAlert kind="error">{error || query.error?.message}</FormAlert>}
    </section>
  )
}
