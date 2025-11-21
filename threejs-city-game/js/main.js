import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x112244); // Dark blue night sky

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// --- LIGHTING ---
const ambientLight = new THREE.AmbientLight(0x404040, 2); // Soft ambient light
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
directionalLight.position.set(10, 20, 5);
scene.add(directionalLight);

// --- CITY ---
// Ground
const groundGeometry = new THREE.PlaneGeometry(200, 200);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Buildings
const buildingMaterial = new THREE.MeshStandardMaterial({ color: 0x555555 });
for (let i = 0; i < 150; i++) {
    const height = Math.random() * 20 + 5;
    const buildingGeometry = new THREE.BoxGeometry(1, height, 1);
    const building = new THREE.Mesh(buildingGeometry, buildingMaterial);

    building.scale.x = Math.random() * 6 + 2;
    building.scale.z = Math.random() * 6 + 2;
    
    building.position.x = Math.random() * 180 - 90;
    building.position.z = Math.random() * 180 - 90;
    building.position.y = height / 2;

    // Avoid placing buildings on the central roads
    if (Math.abs(building.position.x) < 8 || Math.abs(building.position.z) < 8) {
        continue;
    }

    scene.add(building);
}

// --- CAR ---
let car; // Car is now a let, to be assigned by the loader
const loader = new GLTFLoader();
loader.load(
    'assets/car.glb',
    function (gltf) {
        car = gltf.scene;
        car.scale.set(2, 2, 2); // Scale the car up a bit
        car.position.y = 0; // Make sure it's on the ground
        scene.add(car);
    },
    undefined,
    function (error) {
        console.error('An error happened while loading the car model:', error);
        // Fallback to the old red box if loading fails
        car = new THREE.Group();
        const carBodyGeometry = new THREE.BoxGeometry(2, 1, 4);
        const carBodyMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        const carBody = new THREE.Mesh(carBodyGeometry, carBodyMaterial);
        carBody.position.y = 1;
        car.add(carBody);
        scene.add(car);
    }
);


// --- CONTROLS ---
const keyboardState = {};
window.addEventListener('keydown', (e) => {
    keyboardState[e.code] = true;
});
window.addEventListener('keyup', (e) => {
    keyboardState[e.code] = false;
});

const speed = 0.3;
const rotationSpeed = 0.04;

function updateCar() {
    if (keyboardState['ArrowUp'] || keyboardState['KeyW']) {
        car.position.x += Math.sin(car.rotation.y) * speed;
        car.position.z += Math.cos(car.rotation.y) * speed;
    }
    if (keyboardState['ArrowDown'] || keyboardState['KeyS']) {
        car.position.x -= Math.sin(car.rotation.y) * speed * 0.5;
        car.position.z -= Math.cos(car.rotation.y) * speed * 0.5;
    }
    if (keyboardState['ArrowLeft'] || keyboardState['KeyA']) {
        car.rotation.y += rotationSpeed;
    }
    if (keyboardState['ArrowRight'] || keyboardState['KeyD']) {
        car.rotation.y -= rotationSpeed;
    }
}

// --- CAMERA ---
function updateCamera() {
    const cameraOffset = new THREE.Vector3(0, 5, -10); // 5 units up, 10 units back
    cameraOffset.applyQuaternion(car.quaternion);
    cameraOffset.add(car.position);
    
    camera.position.lerp(cameraOffset, 0.1); // Use lerp for smoother camera movement
    camera.lookAt(car.position);
}

// --- RESIZE ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- ANIMATION LOOP ---
function animate() {
    requestAnimationFrame(animate);

    // Only update if the car has been loaded
    if (car) {
        updateCar();
        updateCamera();
    }

    renderer.render(scene, camera);
}

animate();