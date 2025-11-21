import * as THREE from 'three';

export function createCar(): THREE.Mesh {
  const carGeometry = new THREE.BoxGeometry(2, 1, 4); // width, height, length
  const carMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const car = new THREE.Mesh(carGeometry, carMaterial);
  car.position.y = 0.5;
  return car;
}
