import net from "node:net";
import tls from "node:tls";
import selfsigned from "selfsigned";

export type MockFtpsServerOptions = {
  host?: string;
  authTlsMode?: "accept" | "reject534";
  authMode?: "accept" | "reject530";
  listMode?: "success" | "reject550";
  hangAfterTls?: boolean;
  files?: Array<{ name: string; type: "file" | "directory"; size: number }>;
  tlsServername?: string;
};

export type MockFtpsServerHandle = {
  port: number;
  host: string;
  certPem: string;
  commands: string[];
  userReceived: boolean;
  passwordReceived: boolean;
  close: () => Promise<void>;
};

function encodePasvReply(host: string, port: number): string {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    throw new Error("Mock FTPS server requires an IPv4 host for PASV replies.");
  }
  const p1 = Math.floor(port / 256);
  const p2 = port % 256;
  return `227 Entering Passive Mode (${parts.join(",")},${p1},${p2})`;
}

function formatListLine(file: { name: string; type: "file" | "directory"; size: number }): string {
  const type = file.type === "directory" ? "d" : "-";
  return `${type}rw-r--r--   1 owner    group        ${file.size} Jan 01 12:00 ${file.name}`;
}

function createTlsCredentials(servername: string): { key: string; cert: string } {
  const altNames: Array<{ type: number; value?: string; ip?: string }> = [
    { type: 2, value: servername },
  ];
  if (net.isIP(servername) === 4) {
    altNames.push({ type: 7, ip: servername });
  }

  const generated = selfsigned.generate([{ name: "commonName", value: servername }], {
    days: 1,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [{ name: "subjectAltName", altNames }],
  });
  return {
    key: generated.private,
    cert: generated.cert,
  };
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

export async function startPlainFtpServer(options: {
  onCommand: (command: string) => string | "close" | "ignore";
}): Promise<MockFtpsServerHandle> {
  const host = "127.0.0.1";
  const commands: string[] = [];
  let userReceived = false;
  let passwordReceived = false;

  const server = net.createServer((socket) => {
    let buffer = "";
    socket.write("220 Mock FTP Service\r\n");
    socket.on("data", (chunk) => {
      const parsed = readCommand(buffer + chunk.toString("utf8"));
      buffer = parsed.rest;
      for (const command of parsed.commands) {
        commands.push(command);
        if (command.toUpperCase().startsWith("USER")) {
          userReceived = true;
        }
        if (command.toUpperCase().startsWith("PASS")) {
          passwordReceived = true;
        }
        const response = options.onCommand(command);
        if (response === "close") {
          socket.end();
          return;
        }
        if (response !== "ignore") {
          socket.write(`${response}\r\n`);
        }
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, host, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind plain FTP mock server.");
  }

  return {
    host,
    port: address.port,
    certPem: "",
    commands,
    get userReceived() {
      return userReceived;
    },
    get passwordReceived() {
      return passwordReceived;
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

export async function startMockFtpsServer(
  options: MockFtpsServerOptions = {},
): Promise<MockFtpsServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const servername = options.tlsServername ?? "localhost";
  const credentials = createTlsCredentials(servername);
  const commands: string[] = [];
  let userReceived = false;
  let passwordReceived = false;
  const files = options.files ?? [
    { name: "all_clients", type: "file" as const, size: 4096 },
    { name: "archive", type: "directory" as const, size: 0 },
  ];
  const childServers: Array<net.Server | tls.Server> = [];
  const openSockets: Array<net.Socket | tls.TLSSocket> = [];

  const server = net.createServer((socket) => {
    openSockets.push(socket);
    let buffer = "";
    let secured = false;
    let control: net.Socket | tls.TLSSocket = socket;

    const writeReply = (line: string): void => {
      control.write(`${line}\r\n`);
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

    let pendingListing = false;

    let activeDataServer: tls.Server | null = null;

    const startPassiveDataServer = (): void => {
      if (activeDataServer) {
        activeDataServer.close();
      }
      const dataServer = tls.createServer(
        {
          key: credentials.key,
          cert: credentials.cert,
          requestCert: false,
        },
        (secureDataSocket) => {
          openSockets.push(secureDataSocket);
          if (!pendingListing) {
            secureDataSocket.end();
            return;
          }
          const payload = `${files.map(formatListLine).join("\r\n")}\r\n`;
          secureDataSocket.end(payload);
          pendingListing = false;
          writeReply("226 Transfer complete.");
          dataServer.close();
          activeDataServer = null;
        },
      );
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

    const handleSecuredCommand = (command: string): void => {
      trackCommand(command);
      const upper = command.toUpperCase();

      if (options.hangAfterTls) {
        return;
      }

      if (upper.startsWith("USER")) {
        writeReply("331 Password required.");
        return;
      }
      if (upper.startsWith("PASS")) {
        if (options.authMode === "reject530") {
          writeReply("530 Authentication failed.");
          control.end();
          return;
        }
        writeReply("230 User logged in.");
        return;
      }
      if (
        upper.startsWith("PBSZ") ||
        upper.startsWith("PROT") ||
        upper.startsWith("TYPE") ||
        upper.startsWith("STRU") ||
        upper.startsWith("OPTS") ||
        upper.startsWith("NOOP")
      ) {
        writeReply("200 OK");
        return;
      }
      if (upper.startsWith("FEAT")) {
        writeReply("211-Extensions supported:");
        writeReply("211 End");
        return;
      }
      if (upper.startsWith("CWD")) {
        if (options.listMode === "reject550") {
          writeReply("550 Access denied.");
          control.end();
          return;
        }
        writeReply("250 Directory changed.");
        return;
      }
      if (upper.startsWith("EPSV") || upper.startsWith("PASV")) {
        startPassiveDataServer();
        return;
      }
      if (upper.startsWith("LIST") || upper.startsWith("MLSD")) {
        if (options.listMode === "reject550") {
          pendingListing = false;
          activeDataServer?.close();
          activeDataServer = null;
          writeReply("550 Listing denied.");
          return;
        }
        pendingListing = true;
        writeReply("150 Opening data connection.");
        return;
      }
      if (upper.startsWith("QUIT")) {
        writeReply("221 Goodbye.");
        control.end();
      }
    };

    const handlePlainCommand = (command: string): void => {
      trackCommand(command);
      const upper = command.toUpperCase();

      if (upper.startsWith("AUTH TLS")) {
        if (options.authTlsMode === "reject534") {
          writeReply("534 Local policy on server does not allow TLS secure connections.");
          control.end();
          return;
        }
        writeReply("234 Proceed with negotiation.");
        secured = true;
        socket.removeAllListeners("data");
        const tlsSocket = new tls.TLSSocket(socket, {
          isServer: true,
          key: credentials.key,
          cert: credentials.cert,
        });
        control = tlsSocket;
        openSockets.push(tlsSocket);
        let secureBuffer = "";
        tlsSocket.on("data", (chunk) => {
          const parsed = readCommand(secureBuffer + chunk.toString("utf8"));
          secureBuffer = parsed.rest;
          for (const secureCommand of parsed.commands) {
            handleSecuredCommand(secureCommand);
          }
        });
        return;
      }

      writeReply("530 Use AUTH TLS first.");
    };

    socket.write("220 Mock FTP Service\r\n");
    socket.on("data", (chunk) => {
      const parsed = readCommand(buffer + chunk.toString("utf8"));
      buffer = parsed.rest;
      for (const command of parsed.commands) {
        if (secured) {
          handleSecuredCommand(command);
        } else {
          handlePlainCommand(command);
        }
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, host, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind mock FTPS server.");
  }

  return {
    host,
    port: address.port,
    certPem: credentials.cert,
    commands,
    get userReceived() {
      return userReceived;
    },
    get passwordReceived() {
      return passwordReceived;
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
