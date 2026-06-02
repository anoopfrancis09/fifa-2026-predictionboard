import type { Match, PredictionChoice } from '../types';

export function money(value: number | null | undefined) {
  if (value === null || value === undefined) return 'Hidden';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function isBoardClosed(match: Match) {
  if (match.status === 'finished') return true;
  const closeAt = new Date(match.match_time).getTime() - 15 * 60 * 1000;
  return Date.now() >= closeAt;
}

export function closeTime(match: Match) {
  return new Date(new Date(match.match_time).getTime() - 15 * 60 * 1000).toISOString();
}

export function choiceLabel(choice: PredictionChoice, match: Pick<Match, 'team_a' | 'team_b'>) {
  switch (choice) {
    case 'team_a':
      return `${match.team_a} win`;
    case 'team_b':
      return `${match.team_b} win`;
    case 'draw':
      return 'Draw';
  }
}

export function resultTone(value: number | null | undefined) {
  if (value === null || value === undefined) return 'muted';
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'neutral';
}
