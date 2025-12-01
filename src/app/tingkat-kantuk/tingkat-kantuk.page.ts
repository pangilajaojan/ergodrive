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
  testStartTime: Date | null = null;
  testDuration = 0;
  testTimer: any = null;
  isLoadingHistory = false;

  // Statistics
  averageEAR = 0;
  drowsyCount = 0;
  statusDescription = 'Kamera belum dinyalakan';

  // EAR tracking
  private earValues: number[] = [];
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

  // Settings
  settings = {
    testDuration: 300,
    earWarningThreshold: 0.25,
    earDangerThreshold: 0.2,
    enableSound: true,
    enableVibration: true,
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
  }

  ngOnDestroy() {
    this.stopCamera();
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

  // Simulasi mengemudi (Three.js)
  openSimulation() {
    this.isSimulationActive = true;
  }

  closeSimulation() {
    this.isSimulationActive = false;
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
      this.statusMessage = 'Tes Berjalan';
      this.statusClass = 'normal';
      this.statusIcon = 'play';
      this.statusColor = 'primary';

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
  }

  resetTest() {
    try {
      this.stopTest();
      this.testDuration = 0;
      this.averageEAR = 0;
      this.drowsyCount = 0;
      this.earValues = [];
      this.earHistory = [];
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
    
    const statusLower = status.toLowerCase();
    if (statusLower.includes('normal')) {
      return 'success';
    } else if (statusLower.includes('sadar') && statusLower.includes('fokus')) {
      return 'warning';
    } else if (statusLower.includes('mengantuk')) {
      return 'danger';
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
    if (this.testStats.avgEAR < this.settings.earDangerThreshold)
      return 'MULAI MENGANTUK';
    if (this.testStats.avgEAR < this.settings.earWarningThreshold)
      return 'SADAR DAN FOKUS';
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
      this.drowsinessLevel = 'Siap untuk memulai tes';
      this.statusDescription = `EAR: ${ear.toFixed(3)} | Status: Siap Memulai`;
      return;
    }

    const previousStatus = this.drowsinessLevel;
    
    // Mulai Mengantuk (Danger)
    if (ear < this.settings.earDangerThreshold) {
      this.drowsinessLevel = 'MULAI MENGANTUK';
      this.statusClass = 'danger';
      this.statusMessage = 'Mulai Mengantuk';
      this.statusIcon = 'warning';
      this.statusColor = 'danger';
      this.triggerWarning();
      if (!previousStatus.includes('MULAI MENGANTUK')) {
        this.drowsyCount++;
      }
    } 
    // Sadar dan Fokus (Warning)
    else if (ear < this.settings.earWarningThreshold) {
      this.drowsinessLevel = 'SADAR DAN FOKUS';
      this.statusClass = 'warning';
      this.statusMessage = 'Sadar dan Fokus';
      this.statusIcon = 'alert-circle';
      this.statusColor = 'warning';
      this.showWarning = false;
    } 
    // Normal (Safe)
    else {
      this.drowsinessLevel = 'NORMAL';
      this.statusClass = 'success';
      this.statusMessage = 'Normal';
      this.statusIcon = 'checkmark-circle';
      this.statusColor = 'success';
      this.showWarning = false;
    }

    this.statusDescription = `EAR: ${ear.toFixed(3)} | Status: ${
      this.statusMessage
    }`;
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
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
      gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.5);
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