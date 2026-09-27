// Keep the payment-history and scanner-voice browser proofs in the shared
// shard inventory. Each owns its Vite fixture, browser and output folder.
export function browserSuites({ results }) {
  return [
    {
      name: 'payment-history-proof',
      async run() {
        await import('./paymentHistory.mts')
        results.push({ case: 'payment-history-proof', width: 1280 }, { case: 'payment-history-proof', width: 390 })
      },
    },
    {
      name: 'scanner-voice-proof',
      async run() {
        await import('./scannerVoice.mts')
        results.push({ case: 'scanner-voice-proof', width: 1440 }, { case: 'scanner-voice-proof', width: 390 })
      },
    },
  ]
}
