// Release build: no chat room, friends list or leaderboard.
export const chatThere = () => false;
export const reportPlayed = (_room: string) => {};
export const invite = async (_to: string, _room: string) => false;
export const people = async (): Promise<{ key: string; name: string }[]> => [];
