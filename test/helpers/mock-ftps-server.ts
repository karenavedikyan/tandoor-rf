import net from "node:net";

export type MockPlainFtpServerOptions = {
  host?: string;
  authMode?: "accept" | "reject530";
  cwdMode?: "accept" | "reject550";
  listMode?: "success" | "reject550";
  hangAfterAuth?: boolean;
  postAuthDelayMs?: number;
  basePath?: string;
  pwdPath?: string;
  files?: Array<{ name: string; type: "file" | "directory"; size: number }>;
};

export type MockPlainFtpServerHandle = {
  port: number;
  host: string;
  commands: string[];
  userReceived: boolean;
  passwordReceived: boolean;
  controlEnded: boolean;
  close: () => Promise<void>;
};

function formatListLine(file: { name: string; type: "file" | "directory"; size: number }): string {
  const type = file.type === "directory" ? "d" : "-";
  return `${type}rw-r--r--   1 owner    group        ${file.size} Jan 01 12:00 ${file.name}`;
}

function readCommand(buffer: string): { commands: string[]; rest: string } {
  const commands: string[] = [];
  let rest = buffer;
  while (rest.includes("\r\n")) {
    const index = rest.indexOf("\r\n");
    commands.push(rest.slice(0, index));
    rest = rest.slice(index + 2);
  }
  return { commands, rest };
}

export async function startMockPlainFtpServer(
  options: MockPlainFtpServerOptions = {},
): Promise<MockPlainFtpServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const basePath = options.basePath ?? "/1C/Exchange";
  const files = options.files ?? [
    { name: "all_clients", type: "file" as const, size: 4096 },
    { name: "archive", type: "directory" as const, size: 0 },
  ];
  const commands: string[] = [];
  let userReceived = false;
  let passwordReceived = false;
  let controlClosed = false;
  let controlSocket: net.Socket | undefined;
  const childServers: net.Server[] = [];
  const openSockets: net.Socket[] = [];

  const server = net.createServer((socket) => {
    openSockets.push(socket);
    controlSocket = socket;
    socket.on("close", () => {
      controlClosed = true;
    });
    let buffer = "";
    let authenticated = false;
    let currentPath = "/";
    const pwdPath = options.pwdPath ?? basePath;
    let pendingDataSocket: net.Socket | null = null;
    let activeDataServer: net.Server | null = null;

    const writeReply = (line: string): void => {
      socket.write(`${line}\r\n`);
    };

    const trackCommand = (command: string): void => {
      commands.push(command);
      const upper = command.toUpperCase();
      if (upper.startsWith("USER")) {
        userReceived = true;
      }
      if (upper.startsWith("PASS")) {
        passwordReceived = true;
      }
    };

    const sendListing = (dataSocket: net.Socket): void => {
      const payload = `${files.map(formatListLine).join("\r\n")}\r\n`;
      dataSocket.end(payload);
      writeReply("226 Transfer complete.");
      activeDataServer?.close();
      activeDataServer = null;
      pendingDataSocket = null;
    };

    const startPassiveDataServer = (): void => {
      if (activeDataServer) {
        activeDataServer.close();
      }
      const dataServer = net.createServer((dataSocket) => {
        openSockets.push(dataSocket);
        pendingDataSocket = dataSocket;
      });
      childServers.push(dataServer);
      activeDataServer = dataServer;

      dataServer.listen(0, host, () => {
        const dataAddress = dataServer.address();
        if (!dataAddress || typeof dataAddress === "string") {
          writeReply("425 Can't open data connection.");
          return;
        }
        writeReply(`229 Entering Extended Passive Mode (|||${dataAddress.port}|)`);
      });
    };

    const respondLater = (respond: () => void): void => {
      const delay =
        authenticated && options.postAuthDelayMs && options.postAuthDelayMs > 0
          ? options.postAuthDelayMs
          : 0;
      if (delay > 0) {
        setTimeout(respond, delay);
        return;
      }
      respond();
    };

    const handleCommand = (command: string): void => {
      trackCommand(command);
      const upper = command.toUpperCase();

      if (options.hangAfterAuth && authenticated) {
        return;
      }

      if (upper.startsWith("AUTH TLS") || upper.startsWith("AUTH SSL")) {
        writeReply("502 Command not implemented.");
        return;
      }

      if (upper.startsWith("USER")) {
        writeReply("331 Password required.");
        return;
      }
      if (upper.startsWith("PASS")) {
        if (options.authMode === "reject530") {
          writeReply("530 Authentication failed.");
          socket.end();
          return;
        }
        authenticated = true;
        writeReply("230 User logged in.");
        return;
      }
      if (
        upper.startsWith("TYPE") ||
        upper.startsWith("STRU") ||
        upper.startsWith("OPTS") ||
        upper.startsWith("NOOP") ||
        upper.startsWith("FEAT")
      ) {
        if (upper.startsWith("FEAT")) {
          writeReply("211-Extensions supported:");
          writeReply("211 End");
          return;
        }
        writeReply("200 OK");
        return;
      }
      if (upper.startsWith("CWD")) {
        respondLater(() => {
          if (options.cwdMode === "reject550") {
            writeReply("550 Access denied.");
            socket.end();
            return;
          }
          currentPath = basePath;
          writeReply("250 Directory changed.");
        });
        return;
      }
      if (upper.startsWith("PWD") || upper.startsWith("XPWD")) {
        respondLater(() => {
          writeReply(`257 "${pwdPath}" is the current directory.`);
        });
        return;
      }
      if (upper.startsWith("EPSV") || upper.startsWith("PASV")) {
        startPassiveDataServer();
        return;
      }
      if (upper.startsWith("LIST") || upper.startsWith("MLSD")) {
        respondLater(() => {
          if (options.listMode === "reject550") {
            pendingDataSocket?.destroy();
            pendingDataSocket = null;
            activeDataServer?.close();
            activeDataServer = null;
            writeReply("550 Listing denied.");
            return;
          }
          writeReply("150 Opening data connection.");
          if (pendingDataSocket) {
            sendListing(pendingDataSocket);
          }
        });
        return;
      }
      if (upper.startsWith("QUIT")) {
        writeReply("221 Goodbye.");
        socket.end();
        return;
      }

      writeReply("200 OK");
    };

    socket.write("220 Mock FTP Service\r\n");
    socket.on("data", (chunk) => {
      const parsed = readCommand(buffer + chunk.toString("utf8"));
      buffer = parsed.rest;
      for (const command of parsed.commands) {
        handleCommand(command);
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, host, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind mock plain FTP server.");
  }

  return {
    host,
    port: address.port,
    commands,
    get userReceived() {
      return userReceived;
    },
    get passwordReceived() {
      return passwordReceived;
    },
    get controlEnded() {
      return controlClosed || controlSocket?.destroyed === true;
    },
    close: async () => {
      for (const child of childServers.splice(0)) {
        await new Promise<void>((resolve) => child.close(() => resolve()));
      }
      for (const openSocket of openSockets.splice(0)) {
        openSocket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

/** @deprecated Use startMockPlainFtpServer for plain FTP tests. */
export const startMockFtpsServer = startMockPlainFtpServer;

/** @deprecated Use startMockPlainFtpServer for plain FTP tests. */
export const startPlainFtpServer = startMockPlainFtpServer;
