export type CheckType =
  | 'safe-browsing'
  | 'whois'
  | 'ssl'
  | 'reputation'
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

export interface ReputationDetails {
  riskScore: number;
  unsafe: boolean;
  suspicious: boolean;
  phishing: boolean;
  malware: boolean;
  parking: boolean;
}

export interface ReviewsDetails {
  aggregatedRating: number | null;
  totalReviews: number;
  sourceCount: number;
  sources: Array<{
    name: string;
    rating: number | null;
    totalReviews: number;
    url: string | null;
  }>;
  insufficientReviews: boolean;
  error?: string;
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
  | ReputationDetails
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
