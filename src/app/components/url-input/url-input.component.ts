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

  onSubmit(): void {
    const trimmedUrl = this.url.trim();
    if (trimmedUrl && !this.isLoading) {
      this.urlSubmit.emit(trimmedUrl);
    }
  }

  clearInput(): void {
    this.url = '';
  }
}
