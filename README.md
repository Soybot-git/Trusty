# Trusty

**Verifica l'affidabilità dei siti e-commerce in pochi secondi.**

Trusty è una Progressive Web App (PWA) pensata per aiutare gli utenti italiani a proteggersi dalle truffe online, specialmente quando si trovano link sospetti sui social media.

[Demo Live](https://trusty-4o6.pages.dev/) 

---

## Funzionalità

- **Analisi Istantanea** — Incolla un URL e ottieni un punteggio di affidabilità (0-100)
- **Semaforo Visivo** — Verde (sicuro), giallo (attenzione), rosso (pericolo)
- **Multi-Source Verification** — Controlli incrociati da Google Safe Browsing, VirusTotal, Trustpilot, TrustedShops, Sitejabber e altri
- **PWA Installabile** — Installa l'app sul tuo dispositivo con un tap
- **Condivisione Risultati** — Condividi facilmente il risultato con amici
- **Segnalazione Anomalie** — Segnala risultati errati direttamente dall'app
- **100% Gratuito** — Nessun account richiesto, nessun limite di utilizzo

---

## Come Funziona

### Algoritmo Trust Score

Il punteggio finale (0-100) è calcolato combinando diversi controlli:

| Check | Peso | Descrizione |
|-------|------|-------------|
| Google Safe Browsing | Filtro | Blocco immediato se rilevato malware/phishing |
| Recensioni | 20% | Rating aggregato da Trustpilot, TrustedShops e Sitejabber (min. 20 recensioni totali) |
| Reputazione (VirusTotal) | 40% | Analisi dominio da 70+ engine di sicurezza |
| Certificato SSL | 10% | Verifica connessione sicura HTTPS |
| Età Dominio | 10% | Domini recenti sono più rischiosi |
| Euristiche Trusty | 10% | Typosquatting, TLD sospetti, pattern anomali |

### Controlli Euristici Proprietari

- **Typosquatting** — Rileva domini che imitano brand famosi (es. `amaz0n.com`)
- **TLD Sospetti** — Penalizza estensioni spesso usate per truffe (`.xyz`, `.top`, `.click`)
- **Pattern Anomali** — Troppi trattini, numeri, keyword sospette
- **Brand Recognition** — Riconosce 60+ brand italiani e internazionali

### Soglie di Valutazione

| Punteggio | Stato | Significato |
|-----------|-------|-------------|
| >= 70 | Sicuro | Il sito appare affidabile |
| 40-69 | Attenzione | Procedi con cautela |
| < 40 | Pericolo | Sito probabilmente non affidabile |

### Override di Sicurezza

- Malware/phishing rilevato → **Score 0** (blocco immediato)
- Dominio < 30 giorni → **Max score 50**

### Recensioni

Le recensioni vengono aggregate da **tre fonti** indipendenti per una valutazione più robusta:

- **Trustpilot** — Parsing JSON-LD, microdata e data attributes
- **TrustedShops** — API di rating pubblica
- **Sitejabber** — Parsing JSON-LD, microdata e data attributes

Il rating finale è calcolato come **media pesata sul numero di recensioni** di ciascuna fonte. Se le valutazioni tra le fonti divergono significativamente (differenza > 1.5), il punteggio viene penalizzato di 20 punti.

Se un sito ha meno di 20 recensioni totali (sommate tra tutte le fonti), il check recensioni assegna score 0 e il punteggio massimo raggiungibile è 80.

### Reputazione Dominio

La reputazione del dominio viene analizzata tramite VirusTotal, che aggrega i risultati di oltre 70 engine di sicurezza. Il risk score viene calcolato come percentuale di engine che segnalano il dominio come malicious o suspicious.

### Sistema di Caching

Il caching opera su due livelli per ridurre le chiamate alle API esterne e migliorare i tempi di risposta.

**Client (localStorage)** — I risultati completi vengono salvati nel browser per **24 ore**. Alla scadenza, la entry viene rimossa automaticamente al successivo accesso.

**Server (Cloudflare KV)** — Ogni check viene cachato individualmente con TTL diversi in base alla volatilità del dato:

| Check | TTL | Motivazione |
|-------|-----|-------------|
| WHOIS | 30 giorni | Dati di registrazione stabili |
| Euristiche | 30 giorni | Analisi pattern statica |
| SSL | 7 giorni | Certificati cambiano raramente |
| Safe Browsing | 24 ore (1 ora se pericoloso) | Minacce aggiornate frequentemente |
| Reputazione (VirusTotal) | 24 ore | Risk score dinamico |
| Recensioni | 6 ore | Dato più volatile |

Il caching KV è opzionale: se il binding Cloudflare KV non è configurato, l'app funziona comunque senza cache server-side.

---

## Tech Stack

### Frontend
- **Angular 17+** con standalone components
- **PWA** (Service Worker + Web App Manifest)
- **Mobile-first** responsive design
- Zero dipendenze UI esterne

### Backend
- **Cloudflare Pages Functions** (TypeScript, serverless)
- **Cloudflare KV** per caching

### API Esterne
- Google Safe Browsing API
- VirusTotal API (reputazione dominio)
- Trustpilot, TrustedShops, Sitejabber (scraping dati recensioni)
- RDAP (età dominio)

---

## Installazione

### Prerequisiti

- Node.js 18+
- npm 9+

### Setup Locale

```bash
# Clona il repository
git clone https://github.com/Soybot-git/Trusty.git
cd Trusty

# Installa dipendenze
npm install

# Avvia server di sviluppo
npm start

# Apri http://localhost:4200
```

### Variabili d'Ambiente

Configura nel pannello Cloudflare Dashboard (Workers & Pages → Variables) oppure in `wrangler.jsonc`:

| Variabile / Binding | Descrizione | Obbligatoria |
|-----------|-------------|--------------|
| `GOOGLE_SAFE_BROWSING_KEY` | API key Google Safe Browsing | Si |
| `VIRUSTOTAL_API_KEY` | API key VirusTotal | Si |
| `TRUSTY_KV` | Cloudflare KV Namespace binding | No (caching) |

---

## Struttura Progetto

```
trusty/
├── src/
│   ├── app/
│   │   ├── components/
│   │   │   ├── url-input/           # Input URL con validazione
│   │   │   ├── trust-result/        # Visualizzazione risultato
│   │   │   ├── loading/             # Animazione caricamento
│   │   │   ├── share-buttons/       # Pulsanti condivisione
│   │   │   ├── info-modal/          # Modal "Come funziona"
│   │   │   ├── help-modal/          # Modal aiuto
│   │   │   ├── report-modal/        # Modal segnalazione bug
│   │   │   └── disclaimer-modal/    # Modal disclaimer
│   │   ├── services/
│   │   │   ├── api/
│   │   │   │   ├── safe-browsing.service.ts
│   │   │   │   ├── whois.service.ts
│   │   │   │   ├── ssl.service.ts
│   │   │   │   ├── reputation.service.ts
│   │   │   │   ├── reviews.service.ts
│   │   │   │   └── heuristics.service.ts
│   │   │   ├── scoring.service.ts
│   │   │   └── trust-checker.service.ts
│   │   └── models/
│   │       ├── check-result.model.ts
│   │       └── trust-result.model.ts
│   └── assets/
├── functions/                    # Cloudflare Pages Functions
│   ├── api/
│   │   ├── safe-browsing.ts      # Google Safe Browsing
│   │   ├── whois.ts              # RDAP (età dominio)
│   │   ├── ssl.ts                # Verifica certificato
│   │   ├── reputation.ts         # VirusTotal (reputazione dominio)
│   │   ├── reviews.ts            # Trustpilot (recensioni)
│   │   └── heuristics.ts         # Controlli euristici
│   └── lib/                      # Utilities condivise
│       ├── cache.ts              # Helper caching KV
│       └── types.ts              # Tipi Cloudflare Env
└── wrangler.jsonc                # Configurazione Cloudflare Pages
```

---

### Build Manuale

```bash
npm run build
# Output in dist/trusty/browser
```

---

## Contributing

Le contribuzioni sono benvenute!

1. Fai un fork del repository
2. Crea un branch per la tua feature (`git checkout -b feature/nuova-funzionalita`)
3. Committa le modifiche (`git commit -m 'Aggiunge nuova funzionalità'`)
4. Pusha il branch (`git push origin feature/nuova-funzionalita`)
5. Apri una Pull Request

## Disclaimer

Trusty fornisce una **stima automatizzata** basata su dati pubblicamente verificabili. Il punteggio rappresenta un'opinione tecnica e **non costituisce prova di legittimità o illegittimità di alcun sito**.
Verifica sempre autonomamente prima di effettuare acquisti, specialmente per importi elevati.

**Verifica sempre autonomamente** prima di effettuare acquisti, specialmente per importi elevati.

---

## License

MIT

By SoyBot <\°=°/>