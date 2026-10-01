import sax from "sax";
import type { CatalogRelativeFile } from "./constants";
import {
  MAX_ATTRIBUTE_VALUE_LENGTH,
  MAX_TEXT_NODE_LENGTH,
  MAX_XML_DEPTH,
  MAX_XML_ELEMENTS,
  MAX_XML_PARSE_MS,
} from "./constants";
import type { ValidationIssue } from "./types";

export class XmlSecurityError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "XmlSecurityError";
  }
}

export type SaxEventHandlers = {
  onOpenTag?: (name: string, attributes: Record<string, string>, line: number) => void;
  onText?: (text: string, line: number) => void;
  onCloseTag?: (name: string, line: number) => void;
};

export async function parseXmlBufferSafely(
  input: {
    bytes: Buffer;
    file: CatalogRelativeFile;
    expectedRoot: string;
    deadlineMs?: number;
  },
  handlers: SaxEventHandlers,
): Promise<{ issue?: ValidationIssue }> {
  const deadlineMs = input.deadlineMs ?? MAX_XML_PARSE_MS;
  const started = Date.now();
  let depth = 0;
  let elementCount = 0;
  let rootSeen = false;
  let rootClosed = false;
  let currentText = "";

  return new Promise((resolve) => {
    const parser = sax.createStream(true, {
      lowercase: false,
      xmlns: false,
      position: true,
    });

    const lineAt = (): number | undefined => {
      const position = (parser as sax.SAXStream & { _parser?: { line?: number } })._parser?.line;
      return typeof position === "number" ? position : undefined;
    };

    const fail = (code: string, message: string, line?: number) => {
      parser.removeAllListeners();
      resolve({
        issue: { code, message, file: input.file, line },
      });
    };

    parser.on("doctype", () => {
      fail("XML_DOCTYPE_FORBIDDEN", "DOCTYPE is not allowed.", lineAt());
    });

    parser.on("opentag", (node: sax.Tag) => {
      if (Date.now() - started > deadlineMs) {
        fail("XML_PARSE_TIMEOUT", "XML parse deadline exceeded.", lineAt());
        return;
      }
      elementCount += 1;
      if (elementCount > MAX_XML_ELEMENTS) {
        fail("XML_ELEMENT_LIMIT", "XML element count limit exceeded.", lineAt());
        return;
      }
      depth += 1;
      if (depth > MAX_XML_DEPTH) {
        fail("XML_DEPTH_LIMIT", "XML depth limit exceeded.", lineAt());
        return;
      }
      const attrs: Record<string, string> = {};
      for (const [key, value] of Object.entries(node.attributes)) {
        const text = String(value);
        if (text.length > MAX_ATTRIBUTE_VALUE_LENGTH) {
          fail("XML_ATTRIBUTE_TOO_LONG", `Attribute ${key} exceeds length limit.`, lineAt());
          return;
        }
        attrs[key] = text;
      }
      if (!rootSeen) {
        rootSeen = true;
        if (node.name !== input.expectedRoot) {
          fail(
            "XML_INVALID_ROOT",
            `Expected root <${input.expectedRoot}>, got <${node.name}>.`,
            lineAt(),
          );
          return;
        }
      }
      currentText = "";
      handlers.onOpenTag?.(node.name, attrs, lineAt() ?? 0);
    });

    parser.on("text", (text: string) => {
      currentText += text;
      if (currentText.length > MAX_TEXT_NODE_LENGTH) {
        fail("XML_TEXT_TOO_LONG", "Text node exceeds length limit.", lineAt());
      }
    });

    parser.on("cdata", (text: string) => {
      currentText += text;
      if (currentText.length > MAX_TEXT_NODE_LENGTH) {
        fail("XML_TEXT_TOO_LONG", "CDATA node exceeds length limit.", lineAt());
      }
    });

    parser.on("closetag", (name: string) => {
      handlers.onText?.(currentText.trim(), lineAt() ?? 0);
      handlers.onCloseTag?.(name, lineAt() ?? 0);
      currentText = "";
      depth -= 1;
      if (depth === 0) {
        rootClosed = true;
      }
    });

    parser.on("error", (error: Error) => {
      fail("XML_PARSE_ERROR", error.message, lineAt());
    });

    parser.on("end", () => {
      if (!rootSeen || !rootClosed) {
        resolve({
          issue: {
            code: "XML_EMPTY_OR_INCOMPLETE",
            message: "XML root element is missing or incomplete.",
            file: input.file,
          },
        });
        return;
      }
      resolve({});
    });

    parser.write(input.bytes);
    parser.end();
  });
}

export function ensureNonEmptyFile(bytes: Buffer, file: CatalogRelativeFile): ValidationIssue | null {
  if (bytes.length === 0) {
    return {
      code: "EMPTY_SOURCE_FILE",
      message: "Required catalog file is empty.",
      file,
    };
  }
  return null;
}
