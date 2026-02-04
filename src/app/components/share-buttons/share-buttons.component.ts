import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TrustResult, TRUST_LEVEL_LABEL, TRUST_LEVEL_EMOJI } from '../../models';

@Component({
  selector: 'app-share-buttons',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './share-buttons.component.html',
  styleUrl: './share-buttons.component.css',
})
export class ShareButtonsComponent {
  @Input() result: TrustResult | null = null;

  copied = false;

  private getShareText(): string {
    if (!this.result) return '';

    const emoji = TRUST_LEVEL_EMOJI[this.result.level];
    const label = TRUST_LEVEL_LABEL[this.result.level];

    return `${emoji} Trusty: ${this.result.domain} - ${this.result.score}/100 (${label})\n\nVerifica anche tu: Trusty.app`;
  }

  shareWhatsApp(): void {
    const text = encodeURIComponent(this.getShareText());
    window.open(`https://wa.me/?text=${text}`, '_blank');
  }

  shareTelegram(): void {
    const text = encodeURIComponent(this.getShareText());
    window.open(`https://t.me/share/url?text=${text}`, '_blank');
  }

  async copyToClipboard(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.getShareText());
      this.copied = true;
      setTimeout(() => {
        this.copied = false;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }
}
