/** The game worker's address (vite.config.ts serverWorker()). */
declare module "virtual:heroes-server-worker" {
  const url: string;
  export default url;
}
