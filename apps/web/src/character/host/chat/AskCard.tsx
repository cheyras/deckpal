import { useId, useState } from 'react'
import { Button } from '../../../components/ui/Button'
import type { AskAnswer, AskQuestion } from './askState'

export function AskCard({ questions, onSubmit, onSkip }: {
  questions: readonly AskQuestion[]
  onSubmit: (answers: AskAnswer[]) => void
  onSkip: () => void
}) {
  const baseId = useId()
  const [answers, setAnswers] = useState<AskAnswer[]>(() =>
    questions.map(() => ({ selected: [] })),
  )
  const [otherOpen, setOtherOpen] = useState<boolean[]>(() => questions.map(() => false))

  const update = (index: number, next: AskAnswer) => {
    setAnswers((current) => current.map((answer, at) => at === index ? next : answer))
  }
  const choose = (index: number, label: string) => {
    const question = questions[index]!
    const current = answers[index] ?? { selected: [] }
    const selected = question.multi
      ? current.selected.includes(label)
        ? current.selected.filter((value) => value !== label)
        : [...current.selected, label]
      : current.selected.includes(label) ? [] : [label]
    update(index, { selected })
    setOtherOpen((open) => open.map((value, at) => at === index ? false : value))
  }
  const toggleOther = (index: number) => {
    const opening = !otherOpen[index]
    setOtherOpen((current) => current.map((value, at) => at === index ? opening : value))
    update(index, { selected: [], ...(opening ? { other: answers[index]?.other ?? '' } : {}) })
  }

  return (
    <form
      className="decke-ask-card pointer-events-auto mx-[16px] mb-[10px] shrink-0 p-[14px]"
      aria-label="A few questions from Deck-E"
      onSubmit={(event) => { event.preventDefault(); onSubmit(answers) }}
    >
      <div className="space-y-[16px]">
        {questions.map((question, index) => {
          const answer = answers[index] ?? { selected: [] }
          const inputId = `${baseId}-${index}-other`
          const cueId = `${baseId}-${index}-cue`
          return (
            // The group's DESCRIPTION says how many it takes, so its name stays
            // the question. Multi-select shows it too: "Choose any" is the only
            // thing that tells a sighted reader a second press adds, not swaps.
            <fieldset key={index} className="min-w-0" aria-describedby={cueId}>
              <legend className="sr-only">{question.header}: {question.question}</legend>
              <div className="flex items-start gap-[9px]">
                <span aria-hidden="true" className="decke-ask-header mt-[1px] shrink-0 rounded-full px-[8px] py-[2px] text-[10.5px] font-bold leading-[16px] uppercase tracking-[0.06em]">
                  {question.header}
                </span>
                <p className="min-w-0 text-[14.5px] font-semibold leading-[21px] text-text-primary">
                  {question.question}
                </p>
              </div>
              {question.multi ? (
                <p id={cueId} data-ask-cue="multi" className="mt-[4px] text-[11.5px] font-semibold leading-[16px] text-text-muted">
                  Choose any
                </p>
              ) : (
                <span id={cueId} className="sr-only">Choose one</span>
              )}
              <div className="mt-[9px] flex flex-wrap gap-[7px]">
                {question.options.map((option, optionAt) => {
                  const pressed = !otherOpen[index] && answer.selected.includes(option.label)
                  return (
                    <button
                      // By POSITION: labels come from the model and may repeat,
                      // and a repeated key makes React drop or reuse a button.
                      key={optionAt}
                      type="button"
                      aria-pressed={pressed}
                      onClick={() => choose(index, option.label)}
                      className="decke-ask-choice rounded-[10px] border px-[10px] py-[7px] text-left text-[13px] leading-[18px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-action-primary/50"
                    >
                      <span className="block font-semibold">{option.label}</span>
                      {option.description ? <span className="mt-[1px] block text-[11.5px] leading-[16px] text-text-muted">{option.description}</span> : null}
                    </button>
                  )
                })}
                <button
                  type="button"
                  aria-pressed={Boolean(otherOpen[index])}
                  aria-controls={inputId}
                  onClick={() => toggleOther(index)}
                  className="decke-ask-choice rounded-[10px] border px-[10px] py-[7px] text-left text-[13px] font-semibold leading-[18px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-action-primary/50"
                >
                  Other…
                </button>
              </div>
              {otherOpen[index] ? (
                <div className="mt-[8px]">
                  <label htmlFor={inputId} className="sr-only">Other answer for {question.header}</label>
                  <input
                    id={inputId}
                    type="text"
                    maxLength={200}
                    value={answer.other ?? ''}
                    onChange={(event) => update(index, { selected: [], other: event.target.value })}
                    className="decke-ask-other w-full rounded-[10px] border border-border-default bg-surface-primary px-[10px] py-[8px] text-[14px] leading-[20px] text-text-primary outline-none placeholder:text-text-muted focus-visible:border-action-primary focus-visible:ring-2 focus-visible:ring-action-primary/35"
                    placeholder="Type your answer"
                  />
                </div>
              ) : null}
            </fieldset>
          )
        })}
      </div>
      <div className="mt-[14px] flex flex-wrap items-center gap-[8px]">
        <Button variant="ghost" size="sm" onClick={onSkip}>Skip</Button>
        <Button variant="primary" size="sm" type="submit">Submit</Button>
      </div>
    </form>
  )
}
