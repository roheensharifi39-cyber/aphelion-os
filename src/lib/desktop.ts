import type { GeneratedImage, WindowLayout } from '../types';

export function newWindowLayout(index = 0): WindowLayout {
  return { x: 50 + index % 5 * 38, y: 132 + index % 5 * 26, width: 400, height: 420, order: Date.now(), open: true };
}
export function constrainWindow(layout: WindowLayout, width: number, height: number): WindowLayout {
  const mobile = width <= 600, short = height <= 500;
  const top = short ? 68 : mobile ? 205 : 100;
  const panelWidth = Math.min(Math.max(300, layout.width), width - 24);
  const panelHeight = Math.min(Math.max(180, layout.height), Math.max(180, height - top - (short ? 115 : 185)));
  return { ...layout, width: panelWidth, height: panelHeight, x: Math.max(12, Math.min(layout.x, width - panelWidth - 12)), y: Math.max(top, Math.min(layout.y, Math.max(top, height - panelHeight - (short ? 115 : 185)))) };
}
export function validWindow(value: unknown): value is WindowLayout {
  if (!value || typeof value !== 'object') return false;
  const layout = value as WindowLayout;
  return ['x','y','width','height','order'].every(key => Number.isFinite(layout[key as keyof WindowLayout])) && typeof layout.open === 'boolean';
}

// Large image bytes stay in IndexedDB, separate from small saved chat/layout metadata.
let database: Promise<IDBDatabase> | undefined;
function imageDatabase() {
  database ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('aphelion-images', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(new Error('Image storage is unavailable. Download this image to keep a copy.')); };
  });
  return database;
}
export async function storeImage(vault: string, image: GeneratedImage): Promise<void> {
  const db = await imageDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('images','readwrite');
    transaction.objectStore('images').put(image, `${vault}:${image.id}`);
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(new Error('Image storage is full. Download the image to keep it.'));
  });
}
export async function readImage(vault: string, id: string): Promise<GeneratedImage | undefined> {
  const db = await imageDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('images').objectStore('images').get(`${vault}:${id}`);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('This image could not be read from device storage.'));
  });
}
