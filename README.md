# Trusty

**Verifica l'affidabilità dei siti e-commerce in pochi secondi.**

Trusty è una Progressive Web App (PWA) pensata per aiutare gli utenti italiani a proteggersi dalle truffe online, specialmente quando si trovano link sospetti sui social media.

[Demo Live](https://trusty-ebon.vercel.app/)

---

## Funzionalità

- **Analisi Istantanea** — Incolla un URL e ottieni un punteggio di affidabilità (0-100)
- **Semaforo Visivo** — Verde (sicuro), giallo (attenzione), rosso (pericolo)
- **Multi-Source Verification** — Controlli incrociati da Google Safe Browsing, VirusTotal, Trustpilot e altri
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
| Reputazione (VirusTotal) | 30% | Analisi dominio da 70+ engine di sicurezza |
| Recensioni (Trustpilot) | 30% | Rating e numero recensioni (min. 20 recensioni) |
| Certificato SSL | 20% | Verifica connessione sicura HTTPS |
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

Le recensioni vengono recuperate direttamente da Trustpilot tramite parsing dei dati strutturati (JSON-LD) dalla pagina di review del dominio. Se un sito ha meno di 20 recensioni su Trustpilot, il check recensioni assegna score 0 (il punteggio massimo senza recensioni è 70).

### Reputazione Dominio

La reputazione del dominio viene analizzata tramite VirusTotal, che aggrega i risultati di oltre 70 engine di sicurezza. Il risk score viene calcolato come percentuale di engine che segnalano il dominio come malicious o suspicious.

---

## Tech Stack

### Frontend
- **Angular 17+** con standalone components
- **PWA** (Service Worker + Web App Manifest)
- **Mobile-first** responsive design
- Zero dipendenze UI esterne

### Backend
- **Vercel Functions** (TypeScript, serverless)
- **Upstash Redis** per caching

### API Esterne
- Google Safe Browsing API
- VirusTotal API (reputazione dominio)
- Trustpilot (scraping dati strutturati JSON-LD)
- RDAP / who.is (età dominio)

---

## Installazione

### Prerequisiti

- Node.js 18+
- npm 9+

### Setup Locale

```bash
# Clona il repository
git clone https://github.com/user/trusty.git
cd trusty

# Installa dipendenze
npm install

# Avvia server di sviluppo
npm start

# Apri http://localhost:4200
```

### Variabili d'Ambiente

Crea un file `.env` o configura in Vercel Dashboard:

| Variabile | Descrizione | Obbligatoria |
|-----------|-------------|--------------|
| `GOOGLE_SAFE_BROWSING_KEY` | API key Google Safe Browsing | Si |
| `VIRUSTOTAL_API_KEY` | API key VirusTotal | Si |
| `UPSTASH_REDIS_REST_URL` | URL Redis Upstash | No (caching) |
| `UPSTASH_REDIS_REST_TOKEN` | Token Redis Upstash | No (caching) |

---

## Struttura Progetto

```
trusty/
├── src/
│   ├── app/
│   │   ├── components/
│   │   │   ├── url-input/        # Input URL con validazione
│   │   │   ├── trust-result/     # Visualizzazione risultato
│   │   │   ├── loading/          # Animazione caricamento
│   │   │   ├── share-buttons/    # Pulsanti condivisione
│   │   │   ├── info-modal/       # Modal "Come funziona"
│   │   │   ├── help-modal/       # Modal aiuto
│   │   │   └── report-modal/     # Modal segnalazione bug
│   │   ├── services/
│   │   │   ├── trust-checker.service.ts
│   │   │   └── scoring.service.ts
│   │   └── models/
│   └── assets/
├── api/                          # Vercel Functions
│   ├── check.ts                  # Endpoint principale (mock)
│   ├── safe-browsing.ts          # Google Safe Browsing
│   ├── whois.ts                  # RDAP + who.is
│   ├── ssl.ts                    # Verifica certificato
│   ├── reputation.ts             # VirusTotal (reputazione dominio)
│   ├── reviews.ts                # Trustpilot (recensioni)
│   ├── heuristics.ts             # Controlli euristici
│   └── lib/                      # Utilities condivise
└── vercel.json
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

MIT © Trusty
