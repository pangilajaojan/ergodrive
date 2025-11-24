import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// --- SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2c3e50); // Dark slate grey

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000 // OPTIMIZATION: Reduced far plane
);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// --- LIGHTING ---
const ambientLight = new THREE.AmbientLight(0x404040, 2.0);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
directionalLight.position.set(20, 40, 20);
directionalLight.castShadow = true;
// OPTIMIZATION: Reduced shadow map resolution
directionalLight.shadow.mapSize.width = 512;
directionalLight.shadow.mapSize.height = 512;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 100;
scene.add(directionalLight);

// --- GROUND ---
const groundGeometry = new THREE.PlaneGeometry(400, 400); // Increased map size
const groundMaterial = new THREE.MeshStandardMaterial({
  color: 0x080808,
  roughness: 0.8,
  metalness: 0.2,
});
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// --- MAP LOADER ---
const loader = new GLTFLoader();

loader.load(
  "assets/models/circuit.glb",
  (gltf) => {
    const circuit = gltf.scene;
    circuit.position.set(0, 0, 0); // Adjust as needed
    
    // Ensure shadows are cast and received by the circuit model
    circuit.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    scene.add(circuit);
  },
  undefined,
  (error) => {
    console.error("An error happened while loading the circuit model:", error);
  }
);

// --- CAR ---
let car;
loader.load(
  "assets/car.glb",
  (gltf) => {
    car = gltf.scene;
    car.scale.set(2, 2, 2);
    car.position.y = 0;
    car.traverse((child) => {
      if (child.isMesh) child.castShadow = true;
    });
    scene.add(car);
  },
  undefined,
  (error) => {
    console.error("An error happened while loading the car model:", error);
  }
);



// --- CONTROLS ---
const keyboardState = {};
window.addEventListener("keydown", (e) => (keyboardState[e.code] = true));
window.addEventListener("keyup", (e) => (keyboardState[e.code] = false));

const speed = 0.4;
const rotationSpeed = 0.04;

function updateCar() {
  if (!car) return;
  if (keyboardState["ArrowUp"] || keyboardState["KeyW"]) {
    car.position.x += Math.sin(car.rotation.y) * speed;
    car.position.z += Math.cos(car.rotation.y) * speed;
  }
  if (keyboardState["ArrowDown"] || keyboardState["KeyS"]) {
    car.position.x -= Math.sin(car.rotation.y) * speed * 0.5;
    car.position.z -= Math.cos(car.rotation.y) * speed * 0.5;
  }
  if (keyboardState["ArrowLeft"] || keyboardState["KeyA"]) {
    car.rotation.y += rotationSpeed;
  }
  if (keyboardState["ArrowRight"] || keyboardState["KeyD"]) {
    car.rotation.y -= rotationSpeed;
  }
}

// --- CAMERA ---
function updateCamera() {
  if (!car) return;
  const cameraOffset = new THREE.Vector3(0, 5, -10);
  cameraOffset.applyQuaternion(car.quaternion);
  cameraOffset.add(car.position);
  camera.position.lerp(cameraOffset, 0.1);
  camera.lookAt(car.position);
}

// --- RESIZE ---
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- ANIMATION LOOP ---
function animate() {
  requestAnimationFrame(animate);
  updateCar();
  updateCamera();
  renderer.render(scene, camera);
}

animate();
