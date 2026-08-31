import { cp, mkdir, rm } from 'node:fs/promises'

const source = new URL('../apps/api/src/deck/data/', import.meta.url)
const target = new URL('../netlify/functions/data/', import.meta.url)

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await cp(source, target, { recursive: true })

console.log('Prepared Netlify deck-format data')
