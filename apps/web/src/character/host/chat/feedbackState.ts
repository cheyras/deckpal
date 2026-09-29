export type FeedbackVote = -1 | 1

export type FeedbackState = {
  vote: FeedbackVote | null
  comment: string
  share: boolean
  open: boolean
  saving: boolean
  thanked: boolean
  error: string | null
}

export const initialFeedbackState = (): FeedbackState => ({
  vote: null,
  comment: '',
  share: false,
  open: false,
  saving: false,
  thanked: false,
  error: null,
})

export type FeedbackAction =
  | { type: 'vote'; vote: FeedbackVote }
  | { type: 'comment'; comment: string }
  | { type: 'share'; share: boolean }
  | { type: 'skip' }
  | { type: 'saving' }
  | { type: 'saved' }
  | { type: 'failed'; previous: FeedbackState; message?: string }

/** The feedback interaction is data so optimistic writes can restore exactly what was on screen. */
export function feedbackReducer(state: FeedbackState, action: FeedbackAction): FeedbackState {
  switch (action.type) {
    case 'vote':
      if (state.saving) return state
      if (state.vote === action.vote) return initialFeedbackState()
      return { ...state, vote: action.vote, open: true, thanked: false, error: null }
    case 'comment':
      return { ...state, comment: action.comment.slice(0, 500), error: null }
    case 'share':
      return { ...state, share: action.share, error: null }
    case 'skip':
      return { ...state, open: false, thanked: true, error: null }
    case 'saving':
      return { ...state, open: false, saving: true, thanked: true, error: null }
    case 'saved':
      return { ...state, saving: false, thanked: true, error: null }
    case 'failed':
      return { ...action.previous, saving: false, thanked: false, open: true, error: action.message ?? 'Could not save feedback.' }
  }
}
