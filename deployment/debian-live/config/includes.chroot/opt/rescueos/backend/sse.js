/**
 * RescueOS Real-Time SSE (Server-Sent Events) Engine
 * Resilient, low-overhead push event broadcast for local Wi-Fi disaster network.
 */
class SSEManager {
  constructor() {
    this.clients = new Set();
    this.lastEventId = 0;

    // Periodic heartbeat every 25s prevents connection dropouts on mobile hotspot routers
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, 25000);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  /**
   * Register a new client SSE response stream
   */
  addClient(req, res, initialPayload = null) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no'
    });

    // Write initial comment to flush buffers immediately
    res.write(': rescueos-sse-connect\n\n');

    if (initialPayload) {
      this.sendToClient(res, 'state', initialPayload);
    }

    this.clients.add(res);

    req.on('close', () => {
      this.clients.delete(res);
    });

    req.on('error', () => {
      this.clients.delete(res);
    });
  }

  /**
   * Broadcast an event to all connected local clients
   */
  broadcast(type, payload) {
    this.lastEventId++;
    const eventId = this.lastEventId;
    const data = JSON.stringify({ type, payload, eventId, timestamp: new Date().toISOString() });
    const message = `id: ${eventId}\nevent: message\ndata: ${data}\n\n`;

    for (const client of Array.from(this.clients)) {
      try {
        client.write(message);
      } catch (err) {
        this.clients.delete(client);
      }
    }
  }

  /**
   * Send specific event directly to single client stream
   */
  sendToClient(client, type, payload) {
    try {
      const data = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
      client.write(`data: ${data}\n\n`);
    } catch {
      this.clients.delete(client);
    }
  }

  /**
   * Periodic keep-alive comment
   */
  sendHeartbeat() {
    for (const client of Array.from(this.clients)) {
      try {
        client.write(': ping\n\n');
      } catch {
        this.clients.delete(client);
      }
    }
  }

  getClientCount() {
    return this.clients.size;
  }
}

module.exports = new SSEManager();
