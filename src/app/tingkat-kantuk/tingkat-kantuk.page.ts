import {
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
  ElementRef,
  AfterViewInit,
  CUSTOM_ELEMENTS_SCHEMA,
} from '@angular/core';
import {
  trigger,
  state,
  style,
  animate,
  transition,
} from '@angular/animations';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { SharedHeaderComponent } from '../components/shared-header/shared-header.component';
import { FaceMesh } from '@mediapipe/face_mesh';
import { Camera } from '@mediapipe/camera_utils';
import Chart from 'chart.js/auto';
import { FirebaseService } from '../services/firebase.service'; // Import Firebase service
import { LoadingController, ToastController } from '@ionic/angular'; // For UI feedback

declare global {
  interface Window {
    Chart: typeof Chart;
  }
}

@Component({
  selector: 'app-tingkat-kantuk',
  templateUrl: './tingkat-kantuk.page.html',
  styleUrls: ['./tingkat-kantuk.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, SharedHeaderComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  animations: [
    trigger('fadeInOut', [
      state(
        'void',
        style({
          opacity: 0,
          transform: 'translateY(10px)',
        })
      ),
      transition('void => *', [
        animate(
          '300ms ease-out',
          style({
            opacity: 1,
            transform: 'translateY(0)',
          })
        ),
      ]),
      transition('* => void', [
        animate(
          '200ms ease-in',
          style({
            opacity: 0,
            transform: 'translateY(-10px)',
          })
        ),
      ]),
    ]),
  ],
})
export class TingkatKantukPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('video') videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvas') canvasElement!: ElementRef<HTMLCanvasElement>;
  @ViewChild('windowHeader') windowHeader!: ElementRef<HTMLElement>;
  @ViewChild('webcamWindowHeader') webcamWindowHeader!: ElementRef<HTMLElement>;
  @ViewChild('simulationIframe') simulationIframe!: ElementRef<HTMLIFrameElement>;

  // Status variables
  drowsinessLevel = 'Belum Dimulai';
  statusClass = 'normal';
  statusMessage = 'Belum Memulai';
  statusIcon = 'time-outline';
  statusColor = 'medium';
  showWarning = false;
  cameraReady = false;
  isTesting = false;
  isCameraOn = false;
  isSimulationActive = false;
  isSimulationMaximized = false;
  isWebcamWindowOpen = false;
  isWebcamWindowMaximized = false;
  testStartTime: Date | null = null;
  
  // Event listener untuk keyboard saat simulasi aktif
  private keyboardEventListener: ((e: KeyboardEvent) => void) | null = null;
  
  // Window drag and resize state
  private isDragging = false;
  private isResizing = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private windowStartX = 0;
  private windowStartY = 0;
  private resizeDirection = '';
  private windowElement: HTMLElement | null = null;
  testDuration = 0;
  testTimer: any = null;
  isLoadingHistory = false;

  // Statistics
  averageEAR = 0;
  drowsyCount = 0;
  statusDescription = 'Kamera belum dinyalakan';

  // EAR tracking
  private earValues: number[] = [];
  private earHistoryForSmoothing: number[] = [];  // Untuk smoothing status
  private smoothedEAR = 0;  // EAR yang sudah di-smooth
  private lastUpdateTime = 0;
  private readonly UPDATE_INTERVAL = 1000;

  // Test history
  testHistory: Array<{
    id?: string;
    timestamp: Date;
    averageEAR: number;
    duration: string;
    status: string;
  }> = [];

  // Stats
  testStats = {
    totalBlinks: 0,
    avgEAR: 0,
    minEAR: 1,
    maxEAR: 0,
    drowsyCount: 0,
    lastUpdate: new Date(),
  };

  // Camera reference
  private faceMesh: FaceMesh | null = null;
  private cameraInstance: Camera | null = null;
  private earHistory: number[] = [];
  private earChart: any;
  private lastWarningTime = 0;
  private mediaStreamTracks: MediaStreamTrack[] = [];
  private readonly MAX_HISTORY = 30;
  private readonly WARNING_INTERVAL = 5000;
  
  // Variabel untuk analisis yang lebih tajam
  private earHistoryForTrend: number[] = [];  // History untuk analisis trend
  private statusHistory: string[] = [];  // History status untuk konsistensi
  private marHistory: number[] = [];  // History MAR untuk deteksi menguap

  // Settings
  settings = {
    testDuration: 300,
    // Threshold yang lebih akurat dan tajam untuk deteksi kantuk
    earWarningThreshold: 0.25,  // Threshold untuk "Sadar dan Fokus" (sedikit waspada) - ditingkatkan untuk lebih sensitif
    earDangerThreshold: 0.20,   // Threshold untuk "Mulai Mengantuk" (mata mulai menutup) - ditingkatkan untuk lebih sensitif
    earNormalThreshold: 0.28,   // Threshold minimum untuk "Normal" - mata benar-benar terbuka dengan baik
    enableSound: true,
    enableVibration: true,
    // Smoothing untuk menghindari fluktuasi cepat - ditingkatkan untuk hasil lebih stabil
    smoothingWindow: 8,  // Jumlah frame untuk smoothing (ditingkatkan dari 5 ke 8)
    // Analisis trend dan variabilitas untuk akurasi lebih tinggi
    trendWindow: 15,  // Jumlah frame untuk analisis trend
    statusConsistencyFrames: 3,  // Jumlah frame konsisten sebelum status berubah
  };

  constructor(
    private firebaseService: FirebaseService,
    private loadingController: LoadingController,
    private toastController: ToastController
  ) {}

  async ngOnInit() {
    await this.loadTestHistory();
  }

  ngAfterViewInit() {
    this.initChart();
    this.setupWindowDragAndResize();
  }

  ngOnDestroy() {
    this.stopCamera();
    this.removeKeyboardEventListener();
  }
  
  // Menambahkan event listener untuk memastikan keyboard event tidak terblokir
  private addKeyboardEventListener() {
    if (this.keyboardEventListener) return;
    
    this.keyboardEventListener = (e: KeyboardEvent) => {
      // Jika simulasi aktif, biarkan keyboard event langsung ke iframe
      // Jangan prevent default untuk tombol game (arrow keys, WASD)
      const gameKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC'];
      if (this.isSimulationActive && gameKeys.includes(e.code)) {
        // Biarkan event langsung ke iframe, jangan di-capture oleh parent
        e.stopPropagation();
      }
    };
    
    window.addEventListener('keydown', this.keyboardEventListener, true);
  }
  
  // Menghapus event listener keyboard
  private removeKeyboardEventListener() {
    if (this.keyboardEventListener) {
      window.removeEventListener('keydown', this.keyboardEventListener, true);
      this.keyboardEventListener = null;
    }
  }

  // =========================================== 
  // ========== FIREBASE INTEGRATION ==========
  // ===========================================

  // Load test history from Firebase
  async loadTestHistory() {
    const loading = await this.loadingController.create({
      message: 'Memuat riwayat tes...',
      duration: 3000,
    });
    await loading.present();

    try {
      this.isLoadingHistory = true;
      const history = await this.firebaseService.getTestHistory(50);
      
      // Convert timestamp to Date objects
      this.testHistory = history.map((item) => ({
        id: item.id,
        timestamp: new Date(item.timestamp),
        averageEAR: item.averageEAR,
        duration: item.duration,
        status: item.status,
      }));

      await loading.dismiss();
      
      if (history.length > 0) {
        await this.presentToast(`${history.length} riwayat tes berhasil dimuat`, 'success');
      }
    } catch (error) {
      console.error('Error loading test history:', error);
      await loading.dismiss();
      await this.presentToast('Gagal memuat riwayat tes', 'danger');
    } finally {
      this.isLoadingHistory = false;
    }
  }

  // Save test to Firebase
  async saveTestToFirebase() {
    try {
      const testData = {
        timestamp: this.testStartTime ? this.testStartTime.getTime() : Date.now(),
        averageEAR: this.testStats.avgEAR,
        duration: this.formatTime(this.testDuration),
        status: this.getDrowsinessLevel(),
      };

      await this.firebaseService.saveTestHistory(testData);
      await this.presentToast('Hasil tes berhasil disimpan', 'success');
      
      // Reload history to show the new entry
      await this.loadTestHistory();
    } catch (error) {
      console.error('Error saving test:', error);
      await this.presentToast('Gagal menyimpan hasil tes', 'danger');
    }
  }

  // Delete a specific test from history
  async deleteTest(testId: string) {
    const loading = await this.loadingController.create({
      message: 'Menghapus tes...',
    });
    await loading.present();

    try {
      await this.firebaseService.deleteTestHistory(testId);
      await this.loadTestHistory();
      await loading.dismiss();
      await this.presentToast('Tes berhasil dihapus', 'success');
    } catch (error) {
      console.error('Error deleting test:', error);
      await loading.dismiss();
      await this.presentToast('Gagal menghapus tes', 'danger');
    }
  }

  // Clear all test history
  async clearAllHistory() {
    const loading = await this.loadingController.create({
      message: 'Menghapus semua riwayat...',
    });
    await loading.present();

    try {
      await this.firebaseService.clearAllTestHistory();
      this.testHistory = [];
      await loading.dismiss();
      await this.presentToast('Semua riwayat berhasil dihapus', 'success');
    } catch (error) {
      console.error('Error clearing history:', error);
      await loading.dismiss();
      await this.presentToast('Gagal menghapus riwayat', 'danger');
    }
  }

  // Show toast notification
  async presentToast(message: string, color: 'success' | 'danger' | 'warning' = 'success') {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      position: 'top',
      color,
    });
    await toast.present();
  }

  // Export data to JSON
  async exportData() {
    try {
      const history = await this.firebaseService.getTestHistory(1000);
      const dataStr = JSON.stringify(history, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `drowsiness-test-history-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      await this.presentToast('Data berhasil diekspor', 'success');
    } catch (error) {
      console.error('Error exporting data:', error);
      await this.presentToast('Gagal mengekspor data', 'danger');
    }
  }

  // Refresh data
  async refreshData() {
    await this.loadTestHistory();
  }

  // =========================================== 
  // ========== START/STOP TEST LOGIC ========== 
  // ===========================================

  // Simulasi mengemudi (Three.js) dengan aktivasi webcam dan analisis kantuk
  async openSimulation() {
    try {
      // Aktifkan webcam jika belum aktif
      if (!this.isCameraOn) {
        await this.startCamera();
      }
      
      // Mulai analisis kantuk (sama seperti startTest)
      this.isTesting = true;
      this.testStartTime = new Date();
      this.testDuration = 0;
      this.averageEAR = 0;
      this.drowsyCount = 0;
      this.earValues = [];
      this.earHistoryForSmoothing = [];
      this.earHistoryForTrend = [];
      this.statusHistory = [];
      this.marHistory = [];
      this.smoothedEAR = 0;
      this.statusMessage = 'MULAI';
      this.statusClass = 'normal';
      this.statusIcon = 'play';
      this.statusColor = 'primary';
      this.drowsinessLevel = 'MULAI';

      this.initChart();

      this.stopTestTimer();
      this.testTimer = setInterval(() => {
        if (this.isTesting && this.testStartTime) {
          this.testDuration++;
          if (this.earValues.length > 0) {
            const sum = this.earValues.reduce((a, b) => a + b, 0);
            this.averageEAR = sum / this.earValues.length;
            this.earValues = [];
          }
        }
      }, 1000);

      // Mulai deteksi wajah dan analisis kantuk
      await this.startFaceMesh();
      
      // Buka simulasi Three.js sebagai layar utama (fullscreen)
    this.isSimulationActive = true;
      
      // Buka webcam sebagai window yang dapat di-resize
      this.isWebcamWindowOpen = true;
      
      // Tambahkan keyboard event listener untuk memastikan input tidak terblokir
      this.addKeyboardEventListener();
      
      // Setup drag and resize setelah window muncul
      setTimeout(() => {
        this.setupWebcamWindowDragAndResize();
        // Focus ke iframe setelah dimuat untuk memastikan keyboard input langsung bekerja
        this.focusSimulationIframe();
      }, 300);
      
      await this.presentToast('Simulasi dimulai dengan deteksi kantuk aktif', 'success');
    } catch (error) {
      console.error('Gagal memulai simulasi:', error);
      this.statusDescription = 'Gagal memulai simulasi (kamera error)';
      this.statusClass = 'danger';
      this.isTesting = false;
      await this.presentToast('Gagal memulai simulasi', 'danger');
    }
  }

  // Handler saat iframe simulasi selesai dimuat
  onSimulationIframeLoad() {
    // Focus ke iframe setelah dimuat untuk memastikan keyboard input langsung bekerja
    setTimeout(() => {
      this.focusSimulationIframe();
    }, 100);
  }

  // Focus ke iframe simulasi untuk memastikan keyboard input langsung bekerja
  private focusSimulationIframe() {
    try {
      const iframe = this.simulationIframe?.nativeElement;
      if (iframe) {
        // Focus ke iframe element
        iframe.focus();
        // Coba focus ke content window jika memungkinkan (mungkin terblokir cross-origin)
        try {
          if (iframe.contentWindow) {
            iframe.contentWindow.focus();
          }
        } catch (e) {
          // Cross-origin error tidak masalah, keyboard event tetap bekerja
        }
      }
    } catch (error) {
      console.log('Focus iframe error (non-critical):', error);
    }
  }

  // Setup drag and resize functionality untuk window
  private setupWindowDragAndResize() {
    // Setup akan dilakukan setelah view diinisialisasi
    setTimeout(() => {
      if (this.windowHeader?.nativeElement) {
        this.initWindowDrag();
        this.initWindowResize();
      }
    }, 100);
  }

  private initWindowDrag() {
    const header = this.windowHeader?.nativeElement;
    if (!header) return;

    header.addEventListener('mousedown', (e: Event) => {
      const mouseEvent = e as MouseEvent;
      if (this.isSimulationMaximized) return;
      
      const windowEl = header.closest('.simulation-window') as HTMLElement;
      if (!windowEl) return;

      this.isDragging = true;
      this.dragStartX = mouseEvent.clientX;
      this.dragStartY = mouseEvent.clientY;
      
      const rect = windowEl.getBoundingClientRect();
      this.windowStartX = rect.left;
      this.windowStartY = rect.top;
      this.windowElement = windowEl;

      document.addEventListener('mousemove', this.handleDrag);
      document.addEventListener('mouseup', this.stopDrag);
    });
  }

  private handleDrag = (e: Event) => {
    const mouseEvent = e as MouseEvent;
    if (!this.isDragging || !this.windowElement || this.isSimulationMaximized) return;

    const deltaX = mouseEvent.clientX - this.dragStartX;
    const deltaY = mouseEvent.clientY - this.dragStartY;

    let newX = this.windowStartX + deltaX;
    let newY = this.windowStartY + deltaY;

    // Batasi window agar tidak keluar dari viewport
    const maxX = window.innerWidth - this.windowElement.offsetWidth;
    const maxY = window.innerHeight - this.windowElement.offsetHeight;

    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    this.windowElement.style.left = `${newX}px`;
    this.windowElement.style.top = `${newY}px`;
    this.windowElement.style.transform = 'none';
  };

  private stopDrag = () => {
    this.isDragging = false;
    document.removeEventListener('mousemove', this.handleDrag);
    document.removeEventListener('mouseup', this.stopDrag);
  };

  private initWindowResize() {
    const handles = document.querySelectorAll('.resize-handle');
    handles.forEach(handle => {
      handle.addEventListener('mousedown', (e: Event) => {
        const mouseEvent = e as MouseEvent;
        if (this.isSimulationMaximized) return;
        
        mouseEvent.preventDefault();
        this.isResizing = true;
        this.resizeDirection = (handle as HTMLElement).classList[1] || '';
        
        const windowEl = handle.closest('.simulation-window') as HTMLElement;
        if (!windowEl) return;

        this.dragStartX = mouseEvent.clientX;
        this.dragStartY = mouseEvent.clientY;
        this.windowStartX = windowEl.offsetWidth;
        this.windowStartY = windowEl.offsetHeight;
        this.windowElement = windowEl;

        document.addEventListener('mousemove', this.handleResize);
        document.addEventListener('mouseup', this.stopResize);
      });
    });
  }

  private handleResize = (e: Event) => {
    const mouseEvent = e as MouseEvent;
    if (!this.isResizing || !this.windowElement || this.isSimulationMaximized) return;

    const deltaX = mouseEvent.clientX - this.dragStartX;
    const deltaY = mouseEvent.clientY - this.dragStartY;

    let newWidth = this.windowStartX;
    let newHeight = this.windowStartY;
    let newLeft = this.windowElement.offsetLeft;
    let newTop = this.windowElement.offsetTop;

    const minWidth = 400;
    const minHeight = 300;

    if (this.resizeDirection.includes('right')) {
      newWidth = Math.max(minWidth, this.windowStartX + deltaX);
    }
    if (this.resizeDirection.includes('left')) {
      newWidth = Math.max(minWidth, this.windowStartX - deltaX);
      newLeft = this.windowStartX - (newWidth - this.windowStartX);
    }
    if (this.resizeDirection.includes('bottom')) {
      newHeight = Math.max(minHeight, this.windowStartY + deltaY);
    }
    if (this.resizeDirection.includes('top')) {
      newHeight = Math.max(minHeight, this.windowStartY - deltaY);
      newTop = this.windowStartY - (newHeight - this.windowStartY);
    }

    // Batasi ukuran maksimal
    newWidth = Math.min(newWidth, window.innerWidth - newLeft);
    newHeight = Math.min(newHeight, window.innerHeight - newTop);

    this.windowElement.style.width = `${newWidth}px`;
    this.windowElement.style.height = `${newHeight}px`;
    if (this.resizeDirection.includes('left')) {
      this.windowElement.style.left = `${newLeft}px`;
    }
    if (this.resizeDirection.includes('top')) {
      this.windowElement.style.top = `${newTop}px`;
    }
    this.windowElement.style.transform = 'none';
  };

  private stopResize = () => {
    this.isResizing = false;
    document.removeEventListener('mousemove', this.handleResize);
    document.removeEventListener('mouseup', this.stopResize);
  };

  // Toggle maximize/minimize webcam window
  toggleWebcamWindowMaximize() {
    this.isWebcamWindowMaximized = !this.isWebcamWindowMaximized;
    
    // Reset posisi ke kanan bawah saat minimize
    if (!this.isWebcamWindowMaximized) {
      setTimeout(() => {
        const webcamWindow = document.querySelector('.webcam-window') as HTMLElement;
        if (webcamWindow) {
          webcamWindow.style.left = '';
          webcamWindow.style.top = '';
          webcamWindow.style.bottom = '20px';
          webcamWindow.style.right = '20px';
          webcamWindow.style.transform = 'none';
        }
      }, 100);
    }
  }

  // Tutup webcam window
  closeWebcamWindow() {
    this.isWebcamWindowOpen = false;
    this.isWebcamWindowMaximized = false;
  }

  // Setup drag and resize untuk webcam window
  private setupWebcamWindowDragAndResize() {
    setTimeout(() => {
      if (this.webcamWindowHeader?.nativeElement) {
        this.initWebcamWindowDrag();
        this.initWebcamWindowResize();
      }
    }, 100);
  }

  private initWebcamWindowDrag() {
    const header = this.webcamWindowHeader?.nativeElement;
    if (!header) return;

    header.addEventListener('mousedown', (e: Event) => {
      const mouseEvent = e as MouseEvent;
      if (this.isWebcamWindowMaximized) return;
      
      const windowEl = header.closest('.webcam-window') as HTMLElement;
      if (!windowEl) return;

      this.isDragging = true;
      this.dragStartX = mouseEvent.clientX;
      this.dragStartY = mouseEvent.clientY;
      
      const rect = windowEl.getBoundingClientRect();
      this.windowStartX = rect.left;
      this.windowStartY = rect.top;
      this.windowElement = windowEl;

      document.addEventListener('mousemove', this.handleWebcamDrag);
      document.addEventListener('mouseup', this.stopWebcamDrag);
    });
  }

  private handleWebcamDrag = (e: Event) => {
    const mouseEvent = e as MouseEvent;
    if (!this.isDragging || !this.windowElement || this.isWebcamWindowMaximized) return;

    const deltaX = mouseEvent.clientX - this.dragStartX;
    const deltaY = mouseEvent.clientY - this.dragStartY;

    let newX = this.windowStartX + deltaX;
    let newY = this.windowStartY + deltaY;

    const maxX = window.innerWidth - this.windowElement.offsetWidth;
    const maxY = window.innerHeight - this.windowElement.offsetHeight;

    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    this.windowElement.style.left = `${newX}px`;
    this.windowElement.style.top = `${newY}px`;
    this.windowElement.style.transform = 'none';
  };

  private stopWebcamDrag = () => {
    this.isDragging = false;
    document.removeEventListener('mousemove', this.handleWebcamDrag);
    document.removeEventListener('mouseup', this.stopWebcamDrag);
  };

  private initWebcamWindowResize() {
    setTimeout(() => {
      const handles = document.querySelectorAll('.webcam-window .resize-handle');
      handles.forEach(handle => {
        handle.addEventListener('mousedown', (e: Event) => {
          const mouseEvent = e as MouseEvent;
          if (this.isWebcamWindowMaximized) return;
          
          mouseEvent.preventDefault();
          this.isResizing = true;
          this.resizeDirection = (handle as HTMLElement).classList[1] || '';
          
          const windowEl = handle.closest('.webcam-window') as HTMLElement;
          if (!windowEl) return;

          this.dragStartX = mouseEvent.clientX;
          this.dragStartY = mouseEvent.clientY;
          const rect = windowEl.getBoundingClientRect();
          this.windowStartX = rect.width;
          this.windowStartY = rect.height;
          this.windowElement = windowEl;

          document.addEventListener('mousemove', this.handleWebcamResize);
          document.addEventListener('mouseup', this.stopWebcamResize);
        });
      });
    }, 100);
  }

  private handleWebcamResize = (e: Event) => {
    const mouseEvent = e as MouseEvent;
    if (!this.isResizing || !this.windowElement || this.isWebcamWindowMaximized) return;

    const deltaX = mouseEvent.clientX - this.dragStartX;
    const deltaY = mouseEvent.clientY - this.dragStartY;

    let newWidth = this.windowStartX;
    let newHeight = this.windowStartY;
    let newLeft = this.windowElement.offsetLeft;
    let newTop = this.windowElement.offsetTop;

    const minWidth = 250;
    const minHeight = 200;

    if (this.resizeDirection.includes('right')) {
      newWidth = Math.max(minWidth, this.windowStartX + deltaX);
    }
    if (this.resizeDirection.includes('left')) {
      newWidth = Math.max(minWidth, this.windowStartX - deltaX);
      newLeft = this.windowStartX - (newWidth - this.windowStartX);
    }
    if (this.resizeDirection.includes('bottom')) {
      newHeight = Math.max(minHeight, this.windowStartY + deltaY);
    }
    if (this.resizeDirection.includes('top')) {
      newHeight = Math.max(minHeight, this.windowStartY - deltaY);
      newTop = this.windowStartY - (newHeight - this.windowStartY);
    }

    newWidth = Math.min(newWidth, window.innerWidth - newLeft);
    newHeight = Math.min(newHeight, window.innerHeight - newTop);

    this.windowElement.style.width = `${newWidth}px`;
    this.windowElement.style.height = `${newHeight}px`;
    if (this.resizeDirection.includes('left')) {
      this.windowElement.style.left = `${newLeft}px`;
    }
    if (this.resizeDirection.includes('top')) {
      this.windowElement.style.top = `${newTop}px`;
    }
    this.windowElement.style.transform = 'none';
  };

  private stopWebcamResize = () => {
    this.isResizing = false;
    document.removeEventListener('mousemove', this.handleWebcamResize);
    document.removeEventListener('mouseup', this.stopWebcamResize);
  };

  async closeSimulation() {
    try {
      // Jika tes sedang berjalan, hentikan tes dan tampilkan summary
      if (this.isTesting) {
        this.isTesting = false;
        this.stopTestTimer();
        
        // Tampilkan summary analisis sebelum menutup
        await this.showTestSummary();
        
        // Update status
        this.statusMessage = 'Tes Selesai';
        this.statusClass = 'success';
        this.statusIcon = 'stop-circle';
        this.statusColor = 'success';
        this.statusDescription = `Tes Selesai. EAR Rata-rata: ${this.averageEAR.toFixed(3)}`;
      }
      
      // Matikan webcam
      if (this.isCameraOn) {
        await this.stopCamera();
      }
      
      // Tutup simulasi dan webcam window, reset maximize state
    this.isSimulationActive = false;
      this.isSimulationMaximized = false;
      this.isWebcamWindowOpen = false;
      this.isWebcamWindowMaximized = false;
      
      // Hapus keyboard event listener
      this.removeKeyboardEventListener();
      
      // Tampilkan notifikasi bahwa simulasi ditutup
      await this.presentToast('Simulasi ditutup. Data analisis telah disimpan.', 'success');
    } catch (error) {
      console.error('Error closing simulation:', error);
      this.isSimulationActive = false;
      this.isSimulationMaximized = false;
      await this.presentToast('Gagal menutup simulasi', 'danger');
    }
  }

  async startTest() {
    try {
      if (!this.isCameraOn) {
        await this.startCamera();
      }
      this.isTesting = true;
      this.testStartTime = new Date();
      this.testDuration = 0;
      this.averageEAR = 0;
      this.drowsyCount = 0;
      this.earValues = [];
      this.earHistoryForSmoothing = [];
      this.earHistoryForTrend = [];
      this.statusHistory = [];
      this.marHistory = [];
      this.smoothedEAR = 0;
      this.statusMessage = 'MULAI';
      this.statusClass = 'normal';
      this.statusIcon = 'play';
      this.statusColor = 'primary';
      this.drowsinessLevel = 'MULAI';

      this.initChart();

      this.stopTestTimer();
      this.testTimer = setInterval(() => {
        if (this.isTesting && this.testStartTime) {
          this.testDuration++;
          if (this.earValues.length > 0) {
            const sum = this.earValues.reduce((a, b) => a + b, 0);
            this.averageEAR = sum / this.earValues.length;
            this.earValues = [];
          }
        }
      }, 1000);

      await this.startFaceMesh();
    } catch (error) {
      console.error('Gagal memulai tes:', error);
      this.statusDescription = 'Gagal memulai tes (kamera error)';
      this.statusClass = 'danger';
      this.isTesting = false;
    }
  }

  stopTest() {
    this.isTesting = false;
    this.stopTestTimer();
    this.showTestSummary();
    this.statusMessage = 'Tes Selesai';
    this.statusClass = 'success';
    this.statusIcon = 'stop-circle';
    this.statusColor = 'success';
    this.statusDescription = `Tes Selesai. EAR Rata-rata: ${this.averageEAR.toFixed(3)}`;
    
    // Tutup simulasi jika sedang berjalan
    if (this.isSimulationActive) {
      this.isSimulationActive = false;
    }
  }

  resetTest() {
    try {
      this.stopTest();
      this.testDuration = 0;
      this.averageEAR = 0;
      this.drowsyCount = 0;
      this.earValues = [];
      this.earHistory = [];
      this.earHistoryForSmoothing = [];
      this.earHistoryForTrend = [];
      this.statusHistory = [];
      this.marHistory = [];
      this.smoothedEAR = 0;
      this.statusMessage = 'Belum Memulai';
      this.statusClass = 'normal';
      this.statusIcon = 'time-outline';
      this.statusColor = 'medium';
      this.statusDescription = this.isCameraOn
        ? 'Kamera aktif, siap memulai tes'
        : 'Kamera belum dinyalakan';
      this.drowsinessLevel = 'Belum Dimulai';
      this.resetTestStats();
      setTimeout(() => {
        this.initChart();
      }, 100);
      console.log('Test status and EAR graph have been reset');
    } catch (error) {
      console.error('Error resetting test:', error);
    }
  }

  private stopTestTimer() {
    if (this.testTimer) {
      clearInterval(this.testTimer);
      this.testTimer = null;
    }
  }

  private resetTestStats() {
    this.testStats = {
      totalBlinks: 0,
      avgEAR: 0,
      minEAR: 1,
      maxEAR: 0,
      drowsyCount: 0,
      lastUpdate: new Date(),
    };
    this.testDuration = 0;
  }

  // =========================================== 
  // ========== CAMERA & FACE MESH LOGIC ======= 
  // ===========================================

  async toggleCamera() {
    try {
      if (this.isCameraOn) {
        await this.stopCamera();
      } else {
        await this.startCamera();
      }
    } catch (error) {
      console.error('Error toggling camera:', error);
      this.statusDescription = 'Gagal mengontrol kamera';
      this.statusClass = 'danger';
    }
  }

  private async startCamera(): Promise<void> {
    try {
      this.statusDescription = 'Menyiapkan kamera...';

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
          frameRate: { ideal: 30 },
        },
        audio: false,
      });

      const video = this.videoElement.nativeElement;
      video.srcObject = stream;
      this.mediaStreamTracks = stream.getVideoTracks();

      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => {
          video.play().then(() => resolve()).catch(console.error);
        };
      });

      if (!this.faceMesh) {
        await this.setupFaceMesh();
      }

      if (!this.cameraInstance && this.faceMesh) {
        this.cameraInstance = new Camera(video, {
          onFrame: async () => {
            await this.faceMesh!.send({ image: video });
          },
          width: video.videoWidth,
          height: video.videoHeight,
        });
        await this.cameraInstance.start();
      }

      this.statusDescription = 'Kamera aktif, siap mendeteksi.';
      this.isCameraOn = true;
      this.cameraReady = true;

      return Promise.resolve();
    } catch (err) {
      console.error('Error accessing camera:', err);
      this.statusDescription = 'Gagal mengakses kamera';
      this.statusClass = 'danger';
      return Promise.reject(err);
    }
  }

  private async stopCamera(): Promise<void> {
    try {
      if (this.isTesting) {
        this.stopTest();
      }

      if (this.cameraInstance) {
        this.cameraInstance.stop();
        this.cameraInstance = null;
      }

      if (this.mediaStreamTracks.length > 0) {
        this.mediaStreamTracks.forEach((track) => track.stop());
        this.mediaStreamTracks = [];
      }

      if (this.videoElement?.nativeElement) {
        this.videoElement.nativeElement.srcObject = null;
      }

      this.cameraReady = false;
      this.isCameraOn = false;
      this.statusDescription = 'Kamera dimatikan';
      this.statusClass = 'normal';
      return Promise.resolve();
    } catch (error) {
      console.error('Error stopping camera:', error);
      return Promise.reject(error);
    }
  }

  private async setupFaceMesh() {
    this.faceMesh = new FaceMesh({
      locateFile: (file: string) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`,
    });

    this.faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    this.faceMesh.onResults(this.processFaceMeshResults.bind(this));
    return true;
  }

  private async startFaceMesh() {
    if (!this.cameraInstance) {
      await this.startCamera();
    }
  }

  private processFaceMeshResults(results: any) {
    const video = this.videoElement?.nativeElement;
    const canvas = this.canvasElement?.nativeElement;
    const ctx = canvas?.getContext('2d');
    if (!video || !canvas || !ctx) return;

    if (video.videoWidth && video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (results.image) {
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
    }

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      const landmarks = results.multiFaceLandmarks[0];
      this.drawLandmarks(ctx, landmarks);

      const ear = this.computeEAR(landmarks);

      this.testStats.minEAR = Math.min(this.testStats.minEAR, ear);
      this.testStats.maxEAR = Math.max(this.testStats.maxEAR, ear);

      this.updateChart(ear);
      this.updateStatus(ear);

      if (this.isTesting) {
        this.earValues.push(ear);

        const now = new Date();
        const timeDiff =
          (now.getTime() - this.testStats.lastUpdate.getTime()) / 1000;

        if (ear < this.settings.earDangerThreshold && timeDiff > 0.2) {
          this.testStats.totalBlinks++;
          this.testStats.lastUpdate = now;
        }
      }
    }
  }

  // =========================================== 
  // ========== UTILITY & STATUS LOGIC ========= 
  // ===========================================

  getStatusBadgeColor(status: string): string {
    if (!status) return 'medium';
    
    const statusUpper = status.toUpperCase();
    // Prioritas: MULAI MENGANTUK > SADAR DAN FOKUS > NORMAL > MULAI
    if (statusUpper.includes('MULAI MENGANTUK')) {
      return 'danger';
    } else if (statusUpper.includes('SADAR') && statusUpper.includes('FOKUS')) {
      return 'warning';
    } else if (statusUpper.includes('NORMAL')) {
      return 'success';
    } else if (statusUpper.includes('MULAI')) {
      return 'primary';
    }
    return 'medium';
  }

  private async showTestSummary() {
    this.testStats.avgEAR = this.averageEAR;
    const summary = `
      Hasil Tes Kantuk:
      - Durasi: ${this.formatTime(this.testDuration)}
      - Rata-rata EAR: ${this.testStats.avgEAR.toFixed(3)}
      - Kedipan terdeteksi: ${this.testStats.totalBlinks}
      - Status kantuk: ${this.getDrowsinessLevel()}
    `;

    // Save to Firebase
    await this.saveTestToFirebase();

    console.log(summary);
  }

  private getDrowsinessLevel(): string {
    // Gunakan smoothed EAR jika tersedia, jika tidak gunakan average EAR
    const earToCheck = this.smoothedEAR > 0 ? this.smoothedEAR : this.testStats.avgEAR;
    
    if (earToCheck < this.settings.earDangerThreshold)
      return 'MULAI MENGANTUK';
    if (earToCheck < this.settings.earWarningThreshold)
      return 'SADAR DAN FOKUS';
    if (earToCheck === 0 || this.testDuration === 0)
      return 'MULAI';
    return 'NORMAL';
  }

  formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  getStatusIcon(): string {
    if (this.statusClass === 'danger') return 'alert-circle';
    if (this.statusClass === 'warning') return 'warning';
    return 'checkmark-circle';
  }

  // ========== VISUALISASI LANDMARK ==========

  private drawLandmarks(ctx: CanvasRenderingContext2D, landmarks: any[]) {
    if (!ctx) return;

    ctx.fillStyle = 'rgba(0, 255, 0, 0.8)';

    const drawPoint = (p: any, radius = 2) => {
      if (!p) return;
      ctx.beginPath();
      ctx.arc(
        p.x * ctx.canvas.width,
        p.y * ctx.canvas.height,
        radius,
        0,
        2 * Math.PI
      );
      ctx.fill();
    };

    const leftEyeIndices = [33, 160, 158, 133, 153, 144];
    const rightEyeIndices = [362, 385, 387, 263, 373, 380];
    leftEyeIndices.forEach((i) => drawPoint(landmarks[i]));
    rightEyeIndices.forEach((i) => drawPoint(landmarks[i]));
  }

  // ========== PERHITUNGAN EAR ==========

  private computeEAR(landmarks: any[]): number {
    if (!landmarks || landmarks.length === 0) return 0;

    const leftEyeIndices = [33, 160, 158, 133, 153, 144];
    const rightEyeIndices = [362, 385, 387, 263, 373, 380];

    const leftEAR = this.calculateEyeAspectRatio(
      leftEyeIndices.map((i) => landmarks[i])
    );
    const rightEAR = this.calculateEyeAspectRatio(
      rightEyeIndices.map((i) => landmarks[i])
    );

    return (leftEAR + rightEAR) / 2;
  }

  private calculateEyeAspectRatio(eyePoints: any[]): number {
    if (eyePoints.length < 6) return 0;

    const vertical1 = this.distance(eyePoints[1], eyePoints[5]);
    const vertical2 = this.distance(eyePoints[2], eyePoints[4]);
    const horizontal = this.distance(eyePoints[0], eyePoints[3]);

    if (horizontal === 0) return 0;

    return (vertical1 + vertical2) / (2 * horizontal);
  }

  private distance(p1: any, p2: any): number {
    if (!p1 || !p2) return 0;
    return Math.hypot(p2.x - p1.x, p2.y - p1.y);
  }

  // ========== STATUS & PERINGATAN ==========

  private updateStatus(ear: number) {
    if (!this.isTesting) {
      this.drowsinessLevel = 'MULAI';
      this.statusDescription = `EAR: ${ear.toFixed(3)} | Status: Siap Memulai`;
      this.statusClass = 'normal';
      this.statusMessage = 'MULAI';
      this.statusIcon = 'play-circle';
      this.statusColor = 'primary';
      return;
    }

    // Tambahkan EAR ke history untuk smoothing (menghindari fluktuasi cepat)
    this.earHistoryForSmoothing.push(ear);
    if (this.earHistoryForSmoothing.length > this.settings.smoothingWindow) {
      this.earHistoryForSmoothing.shift();
    }

    // Tambahkan EAR ke history untuk analisis trend
    this.earHistoryForTrend.push(ear);
    if (this.earHistoryForTrend.length > this.settings.trendWindow) {
      this.earHistoryForTrend.shift();
    }

    // Hitung smoothed EAR (rata-rata dari beberapa frame terakhir untuk akurasi lebih baik)
    const sum = this.earHistoryForSmoothing.reduce((a, b) => a + b, 0);
    this.smoothedEAR = this.earHistoryForSmoothing.length > 0 
      ? sum / this.earHistoryForSmoothing.length 
      : ear;

    // Analisis trend EAR (apakah cenderung menurun, naik, atau stabil)
    const trend = this.calculateEARTrend();
    
    // Analisis variabilitas EAR (EAR yang sangat bervariasi bisa menunjukkan kelelahan)
    const variability = this.calculateEARVariability();

    // Gunakan smoothed EAR dengan penyesuaian berdasarkan trend dan variabilitas
    let earForStatus = this.smoothedEAR;
    
    // Jika trend menurun, kurangi sedikit EAR untuk deteksi lebih sensitif
    if (trend < -0.01) {
      earForStatus = earForStatus * 0.98;  // Penyesuaian kecil untuk trend menurun
    }
    
    // Jika variabilitas tinggi, bisa menunjukkan kelelahan
    if (variability > 0.05) {
      earForStatus = earForStatus * 0.99;  // Penyesuaian kecil untuk variabilitas tinggi
    }

    const previousStatus = this.drowsinessLevel;
    let newStatus = '';
    let statusClass = '';
    let statusMessage = '';
    let statusIcon = '';
    let statusColor = '';
    
    // Status: MULAI MENGANTUK (Danger) - EAR sangat rendah, mata hampir tertutup
    // Atau trend menurun dengan cepat + EAR rendah
    if (earForStatus < this.settings.earDangerThreshold || 
        (earForStatus < this.settings.earWarningThreshold && trend < -0.02)) {
      newStatus = 'MULAI MENGANTUK';
      statusClass = 'danger';
      statusMessage = 'Mulai Mengantuk';
      statusIcon = 'warning';
      statusColor = 'danger';
    } 
    // Status: SADAR DAN FOKUS (Warning) - EAR menurun, perlu waspada
    // Atau trend menurun atau variabilitas tinggi
    else if (earForStatus < this.settings.earWarningThreshold || 
             trend < -0.005 || 
             variability > 0.04) {
      newStatus = 'SADAR DAN FOKUS';
      statusClass = 'warning';
      statusMessage = 'Sadar dan Fokus';
      statusIcon = 'alert-circle';
      statusColor = 'warning';
    } 
    // Status: NORMAL (Safe) - EAR normal, mata terbuka dengan baik
    // HARUS di atas threshold normal dan trend stabil/naik
    else if (earForStatus >= this.settings.earNormalThreshold && trend >= -0.003) {
      newStatus = 'NORMAL';
      statusClass = 'success';
      statusMessage = 'Normal';
      statusIcon = 'checkmark-circle';
      statusColor = 'success';
    }
    // Status: SADAR DAN FOKUS (jika tidak memenuhi kriteria Normal)
    else {
      newStatus = 'SADAR DAN FOKUS';
      statusClass = 'warning';
      statusMessage = 'Sadar dan Fokus';
      statusIcon = 'alert-circle';
      statusColor = 'warning';
    }

    // Cek konsistensi status sebelum mengubah (menghindari fluktuasi cepat)
    this.statusHistory.push(newStatus);
    if (this.statusHistory.length > this.settings.statusConsistencyFrames) {
      this.statusHistory.shift();
    }

    // Hanya ubah status jika konsisten untuk beberapa frame
    const isStatusConsistent = this.statusHistory.every(s => s === newStatus);
    if (isStatusConsistent || this.statusHistory.length < this.settings.statusConsistencyFrames) {
      this.drowsinessLevel = newStatus;
      this.statusClass = statusClass;
      this.statusMessage = statusMessage;
      this.statusIcon = statusIcon;
      this.statusColor = statusColor;
      
      if (newStatus === 'MULAI MENGANTUK') {
        this.triggerWarning();
        if (!previousStatus.includes('MULAI MENGANTUK')) {
          this.drowsyCount++;
        }
      } else {
        this.showWarning = false;
      }
    }

    // Status description dengan informasi lebih detail
    const trendText = trend < -0.01 ? '↓' : trend > 0.01 ? '↑' : '→';
    const variabilityText = variability > 0.05 ? ' (Tinggi)' : variability > 0.03 ? ' (Sedang)' : ' (Rendah)';
    this.statusDescription = `EAR: ${earForStatus.toFixed(3)} ${trendText} | Variabilitas: ${(variability * 100).toFixed(1)}%${variabilityText} | Status: ${this.statusMessage}`;
  }

  // Fungsi untuk menghitung trend EAR (apakah cenderung menurun, naik, atau stabil)
  private calculateEARTrend(): number {
    if (this.earHistoryForTrend.length < 5) return 0;
    
    // Hitung rata-rata 5 frame terakhir vs 5 frame sebelumnya
    const recentFrames = this.earHistoryForTrend.slice(-5);
    const previousFrames = this.earHistoryForTrend.slice(-10, -5);
    
    if (previousFrames.length === 0) return 0;
    
    const recentAvg = recentFrames.reduce((a, b) => a + b, 0) / recentFrames.length;
    const previousAvg = previousFrames.reduce((a, b) => a + b, 0) / previousFrames.length;
    
    return recentAvg - previousAvg;  // Positif = naik, negatif = turun
  }

  // Fungsi untuk menghitung variabilitas EAR (standar deviasi)
  private calculateEARVariability(): number {
    if (this.earHistoryForTrend.length < 3) return 0;
    
    const recentFrames = this.earHistoryForTrend.slice(-10);  // Ambil 10 frame terakhir
    if (recentFrames.length < 3) return 0;
    
    const mean = recentFrames.reduce((a, b) => a + b, 0) / recentFrames.length;
    const variance = recentFrames.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recentFrames.length;
    return Math.sqrt(variance);  // Standar deviasi
  }

  private triggerWarning() {
    if (!this.isTesting) return;
    const now = Date.now();

    if (now - this.lastWarningTime > this.WARNING_INTERVAL) {
      this.showWarning = true;
      if (this.settings.enableSound) {
        this.playWarningSound();
      }
      if (this.settings.enableVibration && 'vibrate' in navigator) {
        navigator.vibrate([200, 100, 200]);
      }
      this.lastWarningTime = now;

      setTimeout(() => {
        this.showWarning = false;
      }, 3000);
    }
  }

  private playWarningSound() {
    try {
      const audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
      
      // Buat suara peringatan yang sangat keras, tajam, dan berulang-ulang
      const beepCount = 6; // 6 beep untuk lebih berulang dan menarik perhatian
      const beepDuration = 0.2; // Durasi setiap beep sedikit lebih panjang untuk lebih jelas
      const beepInterval = 0.04; // Interval sangat pendek untuk lebih cepat berulang
      
      for (let i = 0; i < beepCount; i++) {
        const startTime = audioContext.currentTime + (i * (beepDuration + beepInterval));
        
        // Buat multiple oscillators dengan frekuensi berbeda untuk harmoni yang lebih kaya dan tajam
        // Oscillator utama - frekuensi tinggi untuk suara yang sangat tajam
        const oscillator1 = audioContext.createOscillator();
        const gainNode1 = audioContext.createGain();
        oscillator1.type = 'square'; // Square wave untuk suara yang keras dan tajam
        oscillator1.frequency.setValueAtTime(2500, startTime); // Frekuensi lebih tinggi (2500Hz) untuk lebih tajam
        // Tambahkan frequency sweep untuk efek yang lebih dramatis
        oscillator1.frequency.exponentialRampToValueAtTime(3000, startTime + beepDuration * 0.3);
        oscillator1.frequency.exponentialRampToValueAtTime(2500, startTime + beepDuration);
        
        // Oscillator kedua - harmoni untuk suara yang lebih kaya
        const oscillator2 = audioContext.createOscillator();
        const gainNode2 = audioContext.createGain();
        oscillator2.type = 'sawtooth'; // Sawtooth untuk suara yang lebih kompleks
        oscillator2.frequency.setValueAtTime(2000, startTime); // Frekuensi sedikit lebih rendah sebagai harmoni
        
        // Oscillator ketiga - frekuensi rendah untuk "punch" yang lebih kuat
        const oscillator3 = audioContext.createOscillator();
        const gainNode3 = audioContext.createGain();
        oscillator3.type = 'square';
        oscillator3.frequency.setValueAtTime(800, startTime); // Frekuensi rendah untuk body suara
        
        // Envelope yang sangat tajam dengan attack yang sangat cepat untuk "punch"
        const attackTime = 0.0005; // Attack sangat cepat untuk suara yang lebih "punchy"
        const sustainTime = beepDuration - 0.001;
        const releaseTime = 0.001; // Release cepat untuk suara yang tajam
        
        // Volume untuk setiap oscillator (disesuaikan untuk balance)
        const volume1 = 0.8; // Oscillator utama - volume tinggi
        const volume2 = 0.4; // Oscillator harmoni - volume sedang
        const volume3 = 0.3; // Oscillator low - volume rendah untuk body
        
        // Envelope untuk oscillator 1 (utama)
        gainNode1.gain.setValueAtTime(0, startTime);
        gainNode1.gain.linearRampToValueAtTime(volume1, startTime + attackTime);
        gainNode1.gain.setValueAtTime(volume1, startTime + attackTime + sustainTime);
        gainNode1.gain.linearRampToValueAtTime(0, startTime + beepDuration);
        
        // Envelope untuk oscillator 2 (harmoni)
        gainNode2.gain.setValueAtTime(0, startTime);
        gainNode2.gain.linearRampToValueAtTime(volume2, startTime + attackTime);
        gainNode2.gain.setValueAtTime(volume2, startTime + attackTime + sustainTime);
        gainNode2.gain.linearRampToValueAtTime(0, startTime + beepDuration);
        
        // Envelope untuk oscillator 3 (low)
        gainNode3.gain.setValueAtTime(0, startTime);
        gainNode3.gain.linearRampToValueAtTime(volume3, startTime + attackTime);
        gainNode3.gain.setValueAtTime(volume3, startTime + attackTime + sustainTime);
        gainNode3.gain.linearRampToValueAtTime(0, startTime + beepDuration);
        
        // Connect semua oscillator ke destination
        oscillator1.connect(gainNode1);
        gainNode1.connect(audioContext.destination);
        
        oscillator2.connect(gainNode2);
        gainNode2.connect(audioContext.destination);
        
        oscillator3.connect(gainNode3);
        gainNode3.connect(audioContext.destination);
        
        // Start dan stop semua oscillator
        oscillator1.start(startTime);
        oscillator1.stop(startTime + beepDuration);
        
        oscillator2.start(startTime);
        oscillator2.stop(startTime + beepDuration);
        
        oscillator3.start(startTime);
        oscillator3.stop(startTime + beepDuration);
      }
    } catch (e) {
      console.warn('Tidak dapat memutar suara peringatan:', e);
    }
  }

  // ========== CHART LOGIC ==========

  private initChart() {
    try {
      const ctx = document.getElementById('earChart') as HTMLCanvasElement;
      if (!ctx) {
        console.warn('Chart canvas element not found');
        return;
      }

      if (this.earChart) {
        this.earChart.destroy();
      }

      const dangerData = Array(this.MAX_HISTORY).fill(
        this.settings.earDangerThreshold
      );
      const warningData = Array(this.MAX_HISTORY).fill(
        this.settings.earWarningThreshold
      );
      this.earChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: Array(this.MAX_HISTORY).fill(''),
          datasets: [
            {
              label: 'EAR (Rata-rata)',
              data: Array(this.MAX_HISTORY).fill(0),
              borderColor: '#3880ff',
              backgroundColor: 'rgba(56, 128, 255, 0.2)',
              borderWidth: 2,
              tension: 0.3,
              fill: true,
              pointRadius: 0,
            },
            {
              label: 'Batas Ngantuk Berat',
              data: dangerData,
              borderColor: '#dc3545',
              borderWidth: 1,
              borderDash: [5, 5],
              pointRadius: 0,
            },
            {
              label: 'Batas Waspada',
              data: warningData,
              borderColor: '#ffc107',
              borderWidth: 1,
              borderDash: [5, 5],
              pointRadius: 0,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            duration: 0,
          },
          scales: {
            y: {
              min: 0,
              max: 0.5,
              grid: { color: 'rgba(200, 200, 200, 0.2)' },
              ticks: { color: 'var(--ion-color-medium)' },
            },
            x: { display: false },
          },
          plugins: {
            legend: { labels: { color: 'var(--ion-text-color)' } },
            tooltip: {
              callbacks: {
                label: (context: any) => {
                  return `${context.dataset.label}: ${context.parsed.y.toFixed(
                    3
                  )}`;
                },
              },
            },
          },
          interaction: { intersect: false, mode: 'index' },
          elements: { line: { tension: 0.4 } },
        },
      });
      console.log('Chart initialized successfully');
    } catch (error) {
      console.error('Error initializing chart:', error);
    }
  }

  private updateChart(ear: number) {
    if (!this.earChart) return;
    try {
      const chartData = this.earChart.data.datasets[0].data;

      chartData.push(ear);

      if (chartData.length > this.MAX_HISTORY) {
        chartData.shift();
      }

      const now = new Date();
      const timeLabel = now.toLocaleTimeString();
      const labels = this.earChart.data.labels;
      if (labels.length < this.MAX_HISTORY) {
        labels.push(timeLabel);
      } else {
        labels.shift();
        labels.push(timeLabel);
      }

      this.earChart.update({
        duration: 0,
        lazy: true,
      });
    } catch (error) {
      console.error('Error updating chart:', error);
    }
  }
}