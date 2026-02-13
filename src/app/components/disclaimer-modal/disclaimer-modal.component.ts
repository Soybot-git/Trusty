import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-disclaimer-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './disclaimer-modal.component.html',
  styleUrl: './disclaimer-modal.component.css',
})
export class DisclaimerModalComponent {
  @Input() isAcknowledged: boolean = false;
  @Output() close = new EventEmitter<void>();
  @Output() dontShowAgain = new EventEmitter<boolean>();

  dontShow: boolean = false;

  ngOnInit(): void {
    this.dontShow = this.isAcknowledged;
  }

  onOverlayClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-overlay')) {
      this.close.emit();
    }
  }

  onGotItClick(): void {
    this.dontShowAgain.emit(this.dontShow);
    this.close.emit();
  }
}
