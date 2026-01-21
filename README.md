# Trusty - Verifica Siti E-commerce

PWA mobile-first per verificare l'affidabilità di siti e-commerce in pochi secondi.

## Obiettivo

Aiutare gli utenti italiani a verificare la sicurezza dei siti e-commerce prima di effettuare acquisti, specialmente da link provenienti da social media.

## Architettura

```
[Angular 17 PWA] → [Vercel Functions] → [API esterne]
       ↓                   ↓
   Mobile UI         Serverless API
```

## Quick Start

```bash
# Installa dipendenze
npm install

# Avvia server di sviluppo
npm start

# Apri http://localhost:4200
```

## Stack Tecnologico

### Frontend
- Angular 17+ con standalone components
- PWA (Service Worker + Web Manifest)
- Mobile-first responsive design
- Zero dipendenze UI esterne

### Backend
- Vercel Functions (TypeScript)
- API serverless per ogni check

## Algoritmo Trust Score

Il punteggio finale (0-100) combina controlli fissi e dinamici:

### Distribuzione Pesi

| Check | Peso | Note |
|-------|------|------|
| Safe Browsing | 0% | Filtro preliminare (blocco se malware) |
| WHOIS (Età dominio) | 15% | Fisso |
| SSL | 15% | Fisso |
| Euristiche | 15% | Fisso |
| Recensioni | 10-30% | Variabile in base al numero di recensioni |
| IPQS (Reputazione) | 45-25% | Complementare (55% - peso recensioni) |
| **TOTALE** | **100%** | Sempre bilanciato |

### Logica Reviews + IPQS (complementare)

| Numero recensioni | Peso Reviews | Peso IPQS |
|-------------------|--------------|-----------|
| < 50 | 10% | 45% |
| 50 - 200 | 20% | 35% |
| > 200 | 30% | 25% |

**Razionale**: poche recensioni potrebbero essere false → IPQS compensa; molte recensioni = feedback reale affidabile → contano di più.

### API Esterne

| Check | Fonte | Stato |
|-------|-------|-------|
| Safe Browsing | Google Safe Browsing API | ✅ Attivo |
| Recensioni | SerpApi (Trustpilot) | ✅ Attivo |
| Età dominio | RDAP + who.is | ✅ Attivo |
| Reputazione | IPQualityScore | ✅ Attivo |
| SSL | Verifica diretta TLS | ✅ Attivo |

### Controlli Proprietari Trusty

**Dettaglio controlli euristici (15%):**
- **Typosquatting** — Rileva domini che imitano brand famosi (es. `amaz0n.com`, `paypa1.com`)
- **TLD sospetti** — Penalizza estensioni spesso usate per truffe (`.xyz`, `.top`, `.click`)
- **Pattern sospetti** — Troppi trattini, numeri, keyword come "free", "gratis", "win"
- **Lunghezza dominio** — Domini eccessivamente lunghi sono sospetti
- **Brand conosciuti** — 60+ brand italiani e internazionali riconosciuti (bonus)

### Soglie Semaforo
- **Safe**: score ≥ 70
- **Caution**: score 40-69
- **Danger**: score < 40

### Override di sicurezza
- Malware/phishing rilevato → blocco immediato (score = 0)
- Dominio < 30 giorni → max score 50

## Struttura Progetto

```
trusty/
├── src/
│   ├── app/
│   │   ├── components/          # UI components
│   │   │   ├── url-input/
│   │   │   ├── trust-result/
│   │   │   ├── loading/
│   │   │   ├── share-buttons/
│   │   │   ├── info-modal/
│   │   │   └── help-modal/
│   │   ├── services/
│   │   │   ├── api/             # Real API services
│   │   │   ├── mock/            # Mock services
│   │   │   ├── trust-checker.service.ts
│   │   │   └── scoring.service.ts
│   │   └── models/
│   ├── environments/
│   └── assets/
├── api/                         # Vercel Functions
│   ├── safe-browsing.ts         # Google Safe Browsing
│   ├── whois.ts                 # RDAP + who.is fallback
│   ├── ssl.ts                   # Verifica certificato TLS
│   ├── ipqs.ts                  # IPQualityScore
│   ├── reviews.ts               # Trustpilot via SerpApi
│   └── heuristics.ts            # Controlli proprietari
├── vercel.json                  # Configurazione Vercel
└── package.json
```

## Variabili d'Ambiente (Vercel)

Configurare in Vercel Dashboard → Settings → Environment Variables:

| Variabile | Descrizione | Obbligatoria |
|-----------|-------------|--------------|
| `GOOGLE_SAFE_BROWSING_KEY` | API key Google Safe Browsing | ✅ Sì |
| `IPQS_API_KEY` | API key IPQualityScore | ✅ Sì |
| `SERP_API_KEY` | API key SerpApi | ✅ Sì |

## Deploy

### Vercel (automatico)

Il progetto è configurato per deploy automatico su push:

```bash
git push origin main
# Vercel rileva automaticamente e fa deploy
```

### Configurazione manuale

```bash
npm run build
# Output in dist/trusty/browser
# Vercel lo serve automaticamente
```

## Sviluppo locale con mock

Per sviluppare senza API reali, in `src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  useMocks: true,  // Usa dati simulati
  apiBaseUrl: '/api',
};
```

## Disclaimer

> Trusty fornisce una stima automatizzata basata su fattori pubblici. Non garantisce la legittimità di alcun sito. Verifica sempre autonomamente prima di acquistare.

## License

MIT
