export type CheckType =
  | 'safe-browsing'
  | 'whois'
  | 'ssl'
  | 'ipqs'
  | 'reviews'
  | 'heuristics';

export type CheckStatus = 'safe' | 'warning' | 'danger' | 'unknown';

export interface SafeBrowsingDetails {
  isMalware: boolean;
  isPhishing: boolean;
  threats: string[];
}

export interface WhoisDetails {
  domainAge: number; // days
  registrar: string;
  creationDate: string;
  expirationDate: string;
  country: string;
}

export interface SSLDetails {
  isValid: boolean;
  issuer: string;
  expiresAt: string;
  daysUntilExpiry: number;
}

export interface IPQSDetails {
  fraudScore: number;
  isProxy: boolean;
  isVpn: boolean;
  isTor: boolean;
  recentAbuse: boolean;
}

export interface ReviewsDetails {
  rating: number; // 1-5
  totalReviews: number;
  source: string;
  url?: string;
}

export interface HeuristicsDetails {
  hasVatNumber: boolean;
  vatNumber?: string;
  domainTld: string;
  hasPrivacyPolicy: boolean;
  hasTerms: boolean;
  hasReturnPolicy: boolean;
  paymentMethods: string[];
  suspiciousPayments: boolean;
}

// Union type for all possible details
export type CheckDetails =
  | SafeBrowsingDetails
  | WhoisDetails
  | SSLDetails
  | IPQSDetails
  | ReviewsDetails
  | HeuristicsDetails
  | { error: boolean }
  | Record<string, unknown>;

export interface CheckResult {
  type: CheckType;
  status: CheckStatus;
  score: number; // 0-100 contribution to final score
  weight: number; // Percentage weight in final calculation
  message: string;
  details?: CheckDetails;
}
