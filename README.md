# 🛡️ Trusty - Web Trust Checker

PWA mobile-first per verificare l'affidabilità di link e-commerce in 3 secondi.

## 🎯 Obiettivo

Aiutare gli utenti italiani (Gen Z/millennials) a verificare la sicurezza dei siti e-commerce prima di effettuare acquisti, specialmente da link provenienti da social media.

## 🏗️ Architettura

```
[Angular 17 PWA] → [Cloudflare Worker] → [API esterne]
     ↓                   ↓
  Mobile UI          Cache + Rate limit
```

## 🚀 Quick Start

### Frontend (Angular PWA)

```bash
# Installa dipendenze
npm install

# Avvia server di sviluppo
npm start
# oppure
ng serve

# Apri http://localhost:4200
```

### Backend (Cloudflare Worker) - Opzionale per fase mock

```bash
cd worker

# Installa dipendenze
npm install

# Avvia in locale
npm run dev
# oppure
wrangler dev

# Server in ascolto su http://localhost:8787
```

## 📱 Test Scenari Mock

L'applicazione usa mock per default (`environment.useMocks = true`). Testa questi URL:

| Pattern URL | Risultato Atteso |
|-------------|------------------|
| `amazon.it`, `ebay.it`, `zalando.it` | 🟢 85-95/100 |
| `test-safe.com` | 🟢 ~80/100 |
| `test-caution.com` | 🟡 ~55/100 |
| `test-danger.com` | 🔴 ~25/100 |
| `scam-site.com`, `fake-shop.com` | 🔴 ~10/100 |
| Qualsiasi altro URL | Random 40-80/100 |

## 🔧 Stack Tecnologico

### Frontend
- Angular 17+ con standalone components
- PWA (Service Worker + Web Manifest)
- Mobile-first responsive design
- Zero dipendenze UI esterne

### Backend
- Cloudflare Workers (TypeScript)
- KV Storage per caching
- Rate limiting per utente

## 📊 Algoritmo Trust Score

Il punteggio finale (0-100) è calcolato combinando:

| Check | Peso | Fonte |
|-------|------|-------|
| Safe Browsing | 25% | Google Safe Browsing API |
| WHOIS | 20% | WhoisXML API |
| Reviews | 20% | SerpApi (Trustpilot) |
| IP Quality | 15% | IPQualityScore |
| SSL | 10% | Verifica interna |
| Euristiche | 10% | Analisi interna |

### Soglie Semaforo
- 🟢 **Safe**: score ≥ 70
- 🟡 **Caution**: score 40-69
- 🔴 **Danger**: score < 40

### Override
- Malware/phishing rilevato → score = 0
- Dominio < 30 giorni → max score 50
- Solo crypto payments → -20 punti

## 📁 Struttura Progetto

```
trusty/
├── src/
│   ├── app/
│   │   ├── components/         # UI components
│   │   │   ├── url-input/
│   │   │   ├── trust-result/
│   │   │   ├── loading/
│   │   │   └── share-buttons/
│   │   ├── services/
│   │   │   ├── api/            # Real API services
│   │   │   ├── mock/           # Mock services
│   │   │   ├── trust-checker.service.ts
│   │   │   └── scoring.service.ts
│   │   └── models/
│   ├── environments/
│   └── assets/icons/
├── worker/                     # Cloudflare Worker
│   ├── src/
│   │   ├── index.ts
│   │   ├── checks/
│   │   └── scoring.ts
│   └── wrangler.toml
└── package.json
```

## 🔐 Variabili d'Ambiente (Produzione)

### Worker Secrets (via `wrangler secret put`)
- `GOOGLE_SAFE_BROWSING_KEY`
- `WHOIS_API_KEY`
- `IPQS_API_KEY`
- `SERP_API_KEY`

## 📲 Deploy

### Frontend (Vercel)
```bash
npm run build
# Deploy dist/trusty su Vercel
```

### Backend (Cloudflare)
```bash
cd worker
npm run deploy
# Aggiorna environment.prod.ts con URL worker
```

## ⚖️ Disclaimer

> "Trusty fornisce una stima automatizzata basata su fattori pubblici. Non garantisce la legittimità di alcun sito. Verifica sempre autonomamente prima di acquistare."

## 📄 License

MIT
