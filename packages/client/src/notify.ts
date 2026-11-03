// Release build: no push notifications.
export const pushSupported = () => false;
export const pushEnabled = async () => false;
export async function enablePush(): Promise<void> {}
export interface PushStatus {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  onServer: boolean | null;
  devices: number;
}
export const pushStatus = async (): Promise<PushStatus> => ({ supported: false, permission: "unsupported", subscribed: false, onServer: null, devices: 0 });
export async function repairPush(): Promise<void> {}
export interface PushTest {
  known: boolean;
  rung: number;
  results: { host: string; status: number }[];
}
export const sendTestPush = async (): Promise<PushTest> => ({ known: false, rung: 0, results: [] });
export async function disablePush(): Promise<void> {}
