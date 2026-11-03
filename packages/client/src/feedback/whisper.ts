// Release build: no on-device speech model.
export const prepareWhisper = async (_onProgress?: (share: number) => void, _setup: unknown = {}): Promise<false> => false;
export const voiceOffline = () => false;
