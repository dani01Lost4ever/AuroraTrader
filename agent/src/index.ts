import { config } from 'dotenv'
import { join } from 'path'
config({ path: join(__dirname, '../../.env') })

import { patchConsole, setLogBroadcaster } from './logs'
patchConsole()

import './brain'
import { createServer } from 'http'
import { connectDB } from './logger'
import { initConfig } from './config'
import { createApiServer } from './api'
import { initWebSocket, broadcast } from './ws'
import { ensureAdminExists } from './auth'
import { loadKeysFromDB } from './keys'
import { engineManager } from './engineManager'

const API_PORT = parseInt(process.env.API_PORT || '3001')

async function main(): Promise<void> {
  await connectDB()
  await initConfig()
  await loadKeysFromDB()
  await ensureAdminExists()

  const app = createApiServer()
  const httpServer = createServer(app)
  initWebSocket(httpServer)
  setLogBroadcaster((entry) => broadcast('log_line', entry))

  httpServer.listen(API_PORT, () => {
    console.log(`[api] Server listening on port ${API_PORT}`)
  })

  await engineManager.start()
  console.log('[engine] Multi-user engine manager started')
}

main().catch(err => {
  console.error('[agent] Fatal:', err)
  process.exit(1)
})
