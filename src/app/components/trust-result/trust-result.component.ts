import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TrustResult, TRUST_LEVEL_LABEL, TRUST_LEVEL_ICON } from '../../models';

@Component({
  selector: 'app-trust-result',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './trust-result.component.html',
  styleUrl: './trust-result.component.css',
})
export class TrustResultComponent {
  @Input() result: TrustResult | null = null;

  readonly TRUST_LEVEL_LABEL = TRUST_LEVEL_LABEL;
  readonly TRUST_LEVEL_ICON = TRUST_LEVEL_ICON;

  // Circle circumference: 2 * PI * 54 (radius) = 339.292
  private readonly circumference = 339.292;

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
