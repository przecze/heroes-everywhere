// Where the server keeps saved games and their timelines.
import { resolve } from "node:path";

export const savesDir = () => process.env.SAVES_DIR ?? resolve(import.meta.dirname, "../../.saves");
