import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { corsOriginList, isOriginAllowed } from '../../common/cors-origin';

// Single PM2 process today (ecosystem.config.cjs: instances=1, fork mode), so
// in-memory Socket.IO rooms are enough to broadcast — no Redis adapter needed.
// If this ever moves to PM2 cluster mode or multiple nodes, wire
// @socket.io/redis-adapter to the Redis container already in docker-compose
// (unused today) so rooms stay in sync across processes.
@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) =>
      isOriginAllowed(origin, corsOriginList()) ? cb(null, true) : cb(new Error('Not allowed by CORS')),
    credentials: false,
  },
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(socket: Socket) {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');

    if (!token) {
      this.logger.warn(`connection rejected: no token (socket ${socket.id})`);
      socket.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwt.verifyAsync<{ sub: number | string; role: string }>(token);
      socket.data.userId = payload.sub;
      // Every push targets a specific recipient's own row (id/created_at/etc
      // match the REST shape) — role-broadcasts are resolved to per-user rows
      // in NotificationsService.notifyRole before reaching the gateway, so
      // there is no separate "role room" to join here.
      socket.join(`user:${payload.sub}`);
    } catch (err) {
      this.logger.warn(`connection rejected: invalid token (socket ${socket.id}) — ${err}`);
      socket.disconnect(true);
    }
  }

  handleDisconnect() {
    // Nothing to clean up — socket.io drops room membership on disconnect itself.
  }

  emitToUser(userId: number | string, payload: unknown) {
    this.server?.to(`user:${userId}`).emit('notification', payload);
  }
}
