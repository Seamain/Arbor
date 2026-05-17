import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let _granted: boolean | null = null;

/**
 * Request notification permission on first call (macOS shows the system dialog).
 * Subsequent calls return the cached result.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (_granted !== null) return _granted;
  try {
    _granted = await isPermissionGranted();
    if (!_granted) {
      const perm = await requestPermission();
      _granted = perm === "granted";
    }
    return _granted;
  } catch {
    _granted = false;
    return false;
  }
}

/**
 * Send a system notification if permission has been granted.
 * Does nothing silently if permission is denied or unavailable.
 */
export async function notify(title: string, body?: string): Promise<void> {
  const ok = await ensureNotificationPermission();
  if (!ok) return;
  try {
    sendNotification({ title, body });
  } catch {
    // non-fatal — user may have revoked permission in System Settings
  }
}
