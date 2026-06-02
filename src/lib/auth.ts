export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function isValidUsername(username: string) {
  return /^[A-Za-z0-9_.-]{3,24}$/.test(username.trim());
}

export function usernameToPrivateEmail(username: string) {
  return `${normalizeUsername(username)}@users.worldcup-board.app`;
}
