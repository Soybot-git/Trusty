import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-report-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './report-modal.component.html',
  styleUrl: './report-modal.component.css',
})
export class ReportModalComponent {
  @Output() close = new EventEmitter<void>();

  problemType = '';
  description = '';
  email = '';
  isSubmitting = false;
  isSuccess = false;
  errorMessage = '';

  private readonly formspreeEndpoint = 'https://formspree.io/f/xykwbbdo';

  problemTypes = [
    { value: 'wrong-result', label: 'Risultato errato' },
    { value: 'site-not-recognized', label: 'Sito non riconosciuto' },
    { value: 'app-error', label: 'Errore app' },
    { value: 'suggestion', label: 'Suggerimento' },
    { value: 'other', label: 'Altro' },
  ];

  onOverlayClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.close.emit();
    }
  }

  async onSubmit(): Promise<void> {
    if (!this.problemType || !this.description.trim()) {
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';

    try {
      const response = await fetch(this.formspreeEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          problemType: this.problemTypes.find(p => p.value === this.problemType)?.label,
          description: this.description.trim(),
          _subject: `[Trusty] Segnalazione: ${this.problemTypes.find(p => p.value === this.problemType)?.label}`,
          ...(this.email.trim() && { _replyto: this.email.trim() }),
        }),
      });

      if (response.ok) {
        this.isSuccess = true;
        setTimeout(() => {
          this.close.emit();
        }, 2000);
      } else {
        throw new Error('Invio fallito');
      }
    } catch {
      this.errorMessage = 'Si è verificato un errore. Riprova più tardi.';
    } finally {
      this.isSubmitting = false;
    }
  }

  get isFormValid(): boolean {
    return !!this.problemType && !!this.description.trim();
  }
}
