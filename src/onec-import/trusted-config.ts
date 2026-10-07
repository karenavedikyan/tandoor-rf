import { isOnecFtpEnabled, loadOnecFtpConfig } from "../onec-ftp/config";
import { redactSecrets } from "../onec-ftp/sanitize";
import { collectEnvRedactionSecrets } from "./job-failure";
import { TRUSTED_ONEC_FTP_BASE_PATH, TRUSTED_ONEC_FTP_HOST } from "./constants";

export type TrustedConfigCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type TrustedConfigValidationResult = {
  ok: boolean;
  errorCode: "CONFIG_INVALID" | null;
  checks: TrustedConfigCheck[];
  message: string;
};

function safeConfigDetail(message: string, env: NodeJS.ProcessEnv): string {
  return redactSecrets(message, collectEnvRedactionSecrets(env)).slice(0, 300);
}

/**
 * Read-only config validation against env and the trusted FTP allowlist.
 * Never returns secret values or masked provider placeholders as real configuration.
 */
export function validateTrustedOnecFtpConfig(
  env: NodeJS.ProcessEnv = process.env,
): TrustedConfigValidationResult {
  const checks: TrustedConfigCheck[] = [];
  const enabled = isOnecFtpEnabled(env);
  checks.push({
    id: "integration_enabled",
    label: "Интеграция FTP включена",
    passed: enabled,
    detail: enabled
      ? "ONEC_FTP_ENABLED активен"
      : "ONEC_FTP_ENABLED не включён",
  });

  if (!enabled) {
    return {
      ok: false,
      errorCode: "CONFIG_INVALID",
      checks,
      message: "Интеграция с FTP 1С отключена.",
    };
  }

  const loaded = loadOnecFtpConfig(env);
  checks.push({
    id: "required_parameters",
    label: "Обязательные параметры FTP заданы",
    passed: loaded.ok,
    detail: loaded.ok
      ? "host, user, password, basePath, port, timeout и security заданы корректно"
      : safeConfigDetail(loaded.message, env),
  });

  if (!loaded.ok) {
    return {
      ok: false,
      errorCode: "CONFIG_INVALID",
      checks,
      message: "Параметры FTP 1С заданы неполностью или некорректно.",
    };
  }

  const normalizedBasePath = loaded.config.basePath.replace(/\/+$/, "");
  const hostAllowed = loaded.config.host === TRUSTED_ONEC_FTP_HOST;
  const basePathAllowed = normalizedBasePath === TRUSTED_ONEC_FTP_BASE_PATH;
  const securityAllowed = loaded.config.security === "plain";

  checks.push({
    id: "trusted_host",
    label: "Host на allowlist",
    passed: hostAllowed,
    detail: hostAllowed
      ? "Host соответствует разрешённому значению"
      : "Host не входит в allowlist интеграции",
  });
  checks.push({
    id: "trusted_base_path",
    label: "Base path на allowlist",
    passed: basePathAllowed,
    detail: basePathAllowed
      ? "Base path соответствует разрешённому значению"
      : "Base path не входит в allowlist интеграции",
  });
  checks.push({
    id: "trusted_security",
    label: "Режим безопасности FTP",
    passed: securityAllowed,
    detail: securityAllowed
      ? "Используется разрешённый режим plain"
      : "Режим security не разрешён политикой",
  });

  const ok = hostAllowed && basePathAllowed && securityAllowed;
  return {
    ok,
    errorCode: ok ? null : "CONFIG_INVALID",
    checks,
    message: ok
      ? "Конфигурация FTP прошла проверку."
      : "Параметры FTP не проходят проверку безопасности (allowlist).",
  };
}

export function isTrustedFtpConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  return validateTrustedOnecFtpConfig(env).ok;
}
