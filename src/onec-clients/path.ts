export function buildClientsFilePath(basePath: string): string {
  const normalized = basePath.replace(/\/+$/, "");
  return `${normalized}/clients/all_clients.json`;
}
