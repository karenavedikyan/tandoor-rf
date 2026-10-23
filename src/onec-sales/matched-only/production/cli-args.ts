export type ProductionCliMode = "preflight" | "validate-backup-proof" | "write-apply" | "write-rollback" | "emit-template";

export type ParsedProductionCliArgs =
  | { ok: true; args: ProductionCliArgs }
  | { ok: false; code: "CLI_ARGS_INVALID"; message: string };

export type ProductionCliArgs = {
  mode: ProductionCliMode;
  operation: "apply" | "rollback";
  manifestFile?: string;
  approvedExecutionHash?: string;
  templateOperation?: "apply" | "rollback";
};

export function parseProductionCliArgs(argv: string[]): ParsedProductionCliArgs {
  let preflight = false;
  let validateBackupProof = false;
  let write = false;
  let writeApply = false;
  let writeRollback = false;
  let emitTemplate = false;
  let manifestFile: string | undefined;
  let approvedExecutionHash: string | undefined;
  let templateOperation: "apply" | "rollback" = "apply";
  let operation: "apply" | "rollback" = "apply";

  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (seen.has(arg)) {
      return { ok: false, code: "CLI_ARGS_INVALID", message: `Duplicate flag: ${arg}` };
    }
    seen.add(arg);
    if (arg === "--preflight") {
      preflight = true;
      continue;
    }
    if (arg === "--validate-backup-proof") {
      validateBackupProof = true;
      continue;
    }
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === "--write-apply") {
      writeApply = true;
      write = true;
      continue;
    }
    if (arg === "--write-rollback") {
      writeRollback = true;
      write = true;
      continue;
    }
    if (arg === "--emit-not-approved-template") {
      emitTemplate = true;
      continue;
    }
    if (arg === "--manifest-file") {
      manifestFile = argv[++i];
      continue;
    }
    if (arg === "--approved-execution-hash") {
      approvedExecutionHash = argv[++i]?.toLowerCase();
      continue;
    }
    if (arg === "--template-operation") {
      const op = argv[++i];
      if (op !== "apply" && op !== "rollback") {
        return { ok: false, code: "CLI_ARGS_INVALID", message: "Invalid --template-operation." };
      }
      templateOperation = op;
      continue;
    }
    if (arg === "--operation") {
      const op = argv[++i];
      if (op !== "apply" && op !== "rollback") {
        return { ok: false, code: "CLI_ARGS_INVALID", message: "Invalid --operation." };
      }
      operation = op;
      continue;
    }
    return { ok: false, code: "CLI_ARGS_INVALID", message: `Unknown argument: ${arg}` };
  }

  const modeCount = [preflight, validateBackupProof, writeApply || writeRollback, emitTemplate].filter(Boolean).length;
  if (modeCount !== 1) {
    return {
      ok: false,
      code: "CLI_ARGS_INVALID",
      message: "Specify exactly one mode: --preflight, --validate-backup-proof, --write-apply, --write-rollback, or --emit-not-approved-template.",
    };
  }
  if (write && !writeApply && !writeRollback) {
    return {
      ok: false,
      code: "CLI_ARGS_INVALID",
      message: "Explicit --write-apply or --write-rollback is required for DML.",
    };
  }
  if (preflight && write) {
    return { ok: false, code: "CLI_ARGS_INVALID", message: "Conflicting --preflight and write mode." };
  }

  if (emitTemplate) {
    return {
      ok: true,
      args: { mode: "emit-template", operation: templateOperation, templateOperation },
    };
  }

  if (!manifestFile) {
    return { ok: false, code: "CLI_ARGS_INVALID", message: "--manifest-file is required." };
  }

  if (writeApply || writeRollback) {
    if (!approvedExecutionHash) {
      return {
        ok: false,
        code: "CLI_ARGS_INVALID",
        message: "Write mode requires --approved-execution-hash.",
      };
    }
    return {
      ok: true,
      args: {
        mode: writeApply ? "write-apply" : "write-rollback",
        operation: writeApply ? "apply" : "rollback",
        manifestFile,
        approvedExecutionHash,
      },
    };
  }

  return {
    ok: true,
    args: {
      mode: validateBackupProof ? "validate-backup-proof" : "preflight",
      operation,
      manifestFile,
      approvedExecutionHash,
    },
  };
}
