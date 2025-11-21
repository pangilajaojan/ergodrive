import { Component, ElementRef, ViewChild, OnInit, OnDestroy, HostListener } from '@angular/core';
import * as THREE from 'three';
import { createCar } from './car';
import { createCity } from './city';

import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

@Component({
  templateUrl: './driving.component.html',
  styleUrls: ['./driving.component.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule],
})
export class DrivingComponent implements OnInit, OnDestroy {
  @ViewChild('rendererCanvas', { static: true })
  private rendererCanvas!: ElementRef<HTMLCanvasElement>;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private car!: THREE.Mesh;

  private animationFrameId!: number;

  private keyboardState: { [key: string]: boolean } = {};

  constructor() {}

  ngOnInit(): void {
    this.initThreeJs();
    this.animate();
  }

  ngOnDestroy(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.renderer) {
      this.renderer.dispose();
    }
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    this.keyboardState[event.key] = true;
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent) {
    this.keyboardState[event.key] = false;
  }

  private initThreeJs(): void {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb); // Sky blue

    // Camera
    this.camera = new THREE.PerspectiveCamera(75, this.getAspectRatio(), 0.1, 1000);
    this.camera.position.set(0, 5, -10);
    this.camera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas: this.rendererCanvas.nativeElement });
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(20, 50, 20);
    this.scene.add(directionalLight);

    // Content
    createCity(this.scene);
    this.car = createCar();
    this.scene.add(this.car);
  }

  private getAspectRatio(): number {
    return this.rendererCanvas.nativeElement.clientWidth / this.rendererCanvas.nativeElement.clientHeight;
  }

  private updateCar(): void {
    const speed = 0.2;
    const rotationSpeed = 0.03;

    if (this.keyboardState['ArrowUp']) {
      this.car.translateZ(speed);
    }
    if (this.keyboardState['ArrowDown']) {
      this.car.translateZ(-speed);
    }
    if (this.keyboardState['ArrowLeft']) {
      this.car.rotateY(rotationSpeed);
    }
    if (this.keyboardState['ArrowRight']) {
      this.car.rotateY(-rotationSpeed);
    }
  }

  private updateCamera(): void {
    const offset = new THREE.Vector3(0, 4, -8);
    offset.applyQuaternion(this.car.quaternion);
    offset.add(this.car.position);

    this.camera.position.lerp(offset, 0.1);
    this.camera.lookAt(this.car.position);
  }

  private animate = (): void => {
    this.animationFrameId = requestAnimationFrame(this.animate);

    this.updateCar();
    this.updateCamera();

    this.renderer.render(this.scene, this.camera);
  }
}
