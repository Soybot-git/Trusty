import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TrustResult } from './models';
import { TrustCheckerService } from './services';
import {
  UrlInputComponent,
  TrustResultComponent,
  LoadingComponent,
  ShareButtonsComponent,
  InfoModalComponent,
  HelpModalComponent,
  ReportModalComponent,
} from './components';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    UrlInputComponent,
    TrustResultComponent,
    LoadingComponent,
    ShareButtonsComponent,
    InfoModalComponent,
    HelpModalComponent,
    ReportModalComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  private trustChecker = inject(TrustCheckerService);

  isLoading = false;
  result: TrustResult | null = null;
  error: string | null = null;
  isInstalled = false;
  showInfoModal = false;
  showHelpModal = false;
  showReportModal = false;

  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  constructor() {
    // Check if app is already installed
    this.isInstalled = window.matchMedia('(display-mode: standalone)').matches;

    // Listen for the beforeinstallprompt event
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      this.isInstalled = false;
    });

    // Listen for app installed event
    window.addEventListener('appinstalled', () => {
      this.isInstalled = true;
      this.deferredPrompt = null;
    });
  }

  onCheckUrl(url: string): void {
    this.isLoading = true;
    this.error = null;
    this.result = null;

    this.trustChecker.check(url).subscribe({
      next: (result) => {
        this.result = result;
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Check failed:', err);
        this.error = 'Si è verificato un errore. Riprova più tardi.';
        this.isLoading = false;
      },
    });
  }

  async installApp(): Promise<void> {
    if (!this.deferredPrompt) {
      // Fallback: show instructions
      alert(
        'Per installare Trusty:\n\n' +
          '📱 iPhone/iPad: Tocca "Condividi" → "Aggiungi a Home"\n\n' +
          '🤖 Android: Tocca il menu ⋮ → "Installa app"'
      );
      return;
    }

    this.deferredPrompt.prompt();
    const { outcome } = await this.deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      this.isInstalled = true;
    }

    this.deferredPrompt = null;
  }
}

// Type for the beforeinstallprompt event
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
