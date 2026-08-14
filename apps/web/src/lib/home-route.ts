/** Default landing route after login — admin ops vs analyst workflow. */
export function homeRouteForRole(role: string | undefined): string {
  if (role === 'admin') return '/dashboard';
  return '/morning';
}
