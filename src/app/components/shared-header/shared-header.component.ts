import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-shared-header',
  templateUrl: './shared-header.component.html',
  styleUrls: ['./shared-header.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class SharedHeaderComponent {
  @Input() pageTitle: string = '';
  @Input() pageSubtitle: string = '';
  @Input() showSleepTestButton: boolean = false;
  @Input() showStopTestButton: boolean = false;
  @Input() showSimulationButton: boolean = false;

  @Output() sleepTestClick = new EventEmitter<void>();
  @Output() stopTestClick = new EventEmitter<void>();
  @Output() simulationClick = new EventEmitter<void>();

  onSleepTestClick() {
    this.sleepTestClick.emit();
  }

  onStopTestClick() {
    this.stopTestClick.emit();
  }

  onSimulationClick() {
    this.simulationClick.emit();
  }
  
  openProfileModal() {
    // Handle profile modal opening logic here
    console.log('Opening profile modal');
  }
}
