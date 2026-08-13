import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { NotificationsGateway } from './notifications.gateway';

export type NotificationType = 'ACTION_REQUIRED' | 'INFO';

export type NotificationPayload = {
  objectType: string;
  objectId: string | number;
  title: string;
  body?: string | null;
  link?: string | null;
};

// Fire-and-forget on purpose everywhere in this service: a notification is a
// side effect of a real transition (transfer submitted, application decided,
// ...) and must never fail the caller's primary write. Every public method
// swallows its own errors after logging them — same contract as
// TransfersService.monitoring.safeEvaluateTransfer.
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject('PG_POOL') private readonly pool: Pool,
    private readonly gateway: NotificationsGateway,
  ) {}

  async notifyUser(userId: number | string, type: NotificationType, payload: NotificationPayload) {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO notifications (recipient_user_id, type, object_type, object_id, title, body, link)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [userId, type, payload.objectType, String(payload.objectId), payload.title, payload.body ?? null, payload.link ?? null],
      );
      this.gateway.emitToUser(userId, rows[0]);
    } catch (err) {
      this.logger.error(`notifyUser(${userId}) failed: ${err}`);
    }
  }

  /**
   * Broadcasts to every user currently holding `role` — one row per recipient,
   * each pushed to its own user's socket with its own row (id/created_at/etc),
   * same shape the REST list returns. Not a single shared "role room" message:
   * each recipient's markRead() must target their own row id, not a stranger's.
   */
  async notifyRole(role: string, type: NotificationType, payload: NotificationPayload) {
    try {
      const { rows: recipients } = await this.pool.query(`SELECT id FROM users WHERE role = $1`, [role]);
      if (recipients.length === 0) return;

      await Promise.all(
        recipients.map(async (r) => {
          const { rows } = await this.pool.query(
            `INSERT INTO notifications (recipient_user_id, type, object_type, object_id, title, body, link)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING *`,
            [r.id, type, payload.objectType, String(payload.objectId), payload.title, payload.body ?? null, payload.link ?? null],
          );
          this.gateway.emitToUser(r.id, rows[0]);
        }),
      );
    } catch (err) {
      this.logger.error(`notifyRole(${role}) failed: ${err}`);
    }
  }

  /** Clears any still-open ACTION_REQUIRED rows for an object — call before moving it to its next state. */
  async resolveForObject(objectType: string, objectId: string | number) {
    try {
      await this.pool.query(
        `UPDATE notifications SET resolved_at = now()
          WHERE object_type = $1 AND object_id = $2
            AND type = 'ACTION_REQUIRED' AND resolved_at IS NULL`,
        [objectType, String(objectId)],
      );
    } catch (err) {
      this.logger.error(`resolveForObject(${objectType}, ${objectId}) failed: ${err}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Read side — plain queries, no fire-and-forget swallowing (a failure here
  // should surface as a normal 500, unlike the write side above).
  // ---------------------------------------------------------------------------

  /** Active items: unresolved ACTION_REQUIRED + all INFO, newest first. */
  async list(userId: number | string, limit = 20) {
    const { rows } = await this.pool.query(
      `SELECT * FROM notifications
        WHERE recipient_user_id = $1 AND (type = 'INFO' OR resolved_at IS NULL)
        ORDER BY created_at DESC
        LIMIT $2`,
      [userId, Math.max(1, Math.min(100, limit))],
    );
    return rows;
  }

  async unreadCount(userId: number | string): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS count FROM notifications
        WHERE recipient_user_id = $1 AND read_at IS NULL
          AND (type = 'INFO' OR resolved_at IS NULL)`,
      [userId],
    );
    return rows[0]?.count ?? 0;
  }

  async markRead(userId: number | string, id: number) {
    const { rows } = await this.pool.query(
      `UPDATE notifications SET read_at = now()
        WHERE id = $1 AND recipient_user_id = $2 AND read_at IS NULL
        RETURNING *`,
      [id, userId],
    );
    return rows[0] ?? null;
  }

  async markAllRead(userId: number | string) {
    await this.pool.query(
      `UPDATE notifications SET read_at = now()
        WHERE recipient_user_id = $1 AND read_at IS NULL`,
      [userId],
    );
  }
}
