import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TrustResult, getTrustLevelLabel } from '../../models';

@Component({
  selector: 'app-trust-result',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './trust-result.component.html',
  styleUrl: './trust-result.component.css',
})
export class TrustResultComponent {
  @Input() result: TrustResult | null = null;

  // Circle circumference: 2 * PI * 54 (radius) = 339.292
  private readonly circumference = 339.292;

  getLevelLabel(level: string): string {
    return getTrustLevelLabel(level as 'safe' | 'caution' | 'danger');
  }

  getLevelIcon(level: string): string {
    switch (level) {
      case 'safe':
        return '✓';
      case 'caution':
        return '!';
      case 'danger':
        return '✕';
      default:
        return '?';
    }
  }

  getStrokeDasharray(): string {
    return `${this.circumference}`;
  }

  getStrokeDashoffset(): string {
    if (!this.result) return `${this.circumference}`;
    const progress = this.result.score / 100;
    const offset = this.circumference * (1 - progress);
    return `${offset}`;
  }
}
