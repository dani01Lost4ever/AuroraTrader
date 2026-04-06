import { WebSocketServer, WebSocket } from 'ws'
import { Server } from 'http'
import { parse } from 'url'
import { verifyToken } from './auth'

let wss: WebSocketServer | null = null
const clients = new Set<WebSocket>()
const clientUsers = new Map<WebSocket, { userId: string; role: 'admin' | 'user' }>()

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws, req) => {
    // Verify JWT from query param: /ws?token=<jwt>
    const { query } = parse(req.url || '', true)
    const token = Array.isArray(query.token) ? query.token[0] : query.token
    const claims = token ? verifyToken(token) : null
    if (!claims || claims.purpose !== 'auth' || !claims.uid) {
      ws.close(4001, 'Unauthorized')
      return
    }

    clients.add(ws)
    clientUsers.set(ws, { userId: claims.uid, role: claims.role === 'admin' ? 'admin' : 'user' })
    ws.on('close', () => { clients.delete(ws); clientUsers.delete(ws) })
    ws.on('error', () => { clients.delete(ws); clientUsers.delete(ws) })

    // Keep-alive ping every 30s
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping()
      else clearInterval(ping)
    }, 30_000)
  })

  console.log('[ws] WebSocket server ready on /ws')
}

export function broadcast(type: string, data: unknown, userId?: string): void {
  if (!wss) return
  const msg = JSON.stringify({ type, data })
  for (const client of clients) {
    if (client.readyState !== WebSocket.OPEN) continue
    const user = clientUsers.get(client)
    if (userId && user?.userId !== userId) continue
    if (!userId && type === 'log_line' && user?.role !== 'admin') continue
    client.send(msg)
  }
}
