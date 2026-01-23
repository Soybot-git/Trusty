import { Component, EventEmitter, Output, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-url-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './url-input.component.html',
  styleUrl: './url-input.component.css',
})
export class UrlInputComponent {
  @Input() isLoading = false;
  @Output() urlSubmit = new EventEmitter<string>();
  @Output() helpClick = new EventEmitter<void>();
  @Output() infoClick = new EventEmitter<void>();

  url = '';

  get isValidUrl(): boolean {
    const trimmed = this.url.trim();
    if (!trimmed) return true; // Campo vuoto non mostra errore
    return trimmed.includes('.') && !trimmed.includes(' ');
  }

  get canSubmit(): boolean {
    const trimmed = this.url.trim();
    return trimmed.length > 0 && this.isValidUrl && !this.isLoading;
  }

  get showError(): boolean {
    return this.url.trim().length > 0 && !this.isValidUrl;
  }

  onSubmit(): void {
    if (this.canSubmit) {
      this.urlSubmit.emit(this.url.trim());
      this.url = '';
    }
  }

  clearInput(): void {
    this.url = '';
  }
}
