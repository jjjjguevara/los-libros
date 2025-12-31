/**
 * Device ID Management
 *
 * Generates and persists a unique device identifier for sync operations.
 */

const DEVICE_ID_KEY = 'los-libros-device-id';

/**
 * Get or create a persistent device ID
 */
export function getDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);

  if (!deviceId) {
    deviceId = generateDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }

  return deviceId;
}

/**
 * Generate a new device ID
 */
function generateDeviceId(): string {
  // Create a unique ID based on timestamp and random values
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  const random2 = Math.random().toString(36).substring(2, 15);

  return `${timestamp}-${random}-${random2}`;
}

/**
 * Reset device ID (for debugging/testing)
 */
export function resetDeviceId(): string {
  const newId = generateDeviceId();
  localStorage.setItem(DEVICE_ID_KEY, newId);
  return newId;
}
