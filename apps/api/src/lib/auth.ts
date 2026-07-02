import type { FastifyRequest } from 'fastify';
import { ROLE_PERMISSIONS, type Permission, type Role } from '@sv/shared';

export interface JwtUser {
  sub: string;
  email: string;
  role: Role;
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function getJwtUser(request: FastifyRequest): JwtUser | null {
  const user = request.user as JwtUser | undefined;
  return user ?? null;
}

export function requirePermission(request: FastifyRequest, permission: Permission): JwtUser {
  const adminKey = process.env.SV_ADMIN_KEY;
  if (adminKey && request.headers['x-admin-key'] === adminKey) {
    return { sub: 'system', email: 'system@admin', role: 'admin' };
  }

  const user = getJwtUser(request);
  if (!user || !hasPermission(user.role, permission)) {
    const err = new Error('Forbidden');
    (err as Error & { statusCode: number }).statusCode = 403;
    throw err;
  }
  return user;
}
