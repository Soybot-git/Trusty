import { CheckResult } from './check-result.model';

export type TrustLevel = 'safe' | 'caution' | 'danger';

export interface TrustResult {
  url: string;
  domain: string;
  score: number; // 0-100
  level: TrustLevel;
  bullets: TrustBullet[];
  details: CheckResult[];
  checkedAt: Date;
}

export interface TrustBullet {
  icon: 'check' | 'warning' | 'danger';
  text: string;
}

// Score thresholds
export const TRUST_THRESHOLDS = {
  SAFE: 70, // >= 70 = green
  CAUTION: 40, // >= 40 = yellow, < 70
  // < 40 = red (danger)
} as const;

export function getTrustLevel(score: number): TrustLevel {
  if (score >= TRUST_THRESHOLDS.SAFE) return 'safe';
  if (score >= TRUST_THRESHOLDS.CAUTION) return 'caution';
  return 'danger';
}

export const TRUST_LEVEL_LABEL: Record<TrustLevel, string> = {
  safe: 'Affidabile',
  caution: 'Attenzione',
  danger: 'Pericoloso',
};

export const TRUST_LEVEL_ICON: Record<TrustLevel, string> = {
  safe: '✓',
  caution: '!',
  danger: '✕',
};

export const TRUST_LEVEL_EMOJI: Record<TrustLevel, string> = {
  safe: '🟢',
  caution: '🟡',
  danger: '🔴',
};
