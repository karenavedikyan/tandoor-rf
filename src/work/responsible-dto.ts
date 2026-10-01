import type { ResponsibleProfileState } from "../bitrix24/tasks/responsible-profile";

export type ResponsiblePublicDto =
  | {
      state: "confirmed";
      displayName: string;
      internalContactEmail: string;
      internalContactUserId: string;
    }
  | {
      state: "unknown";
      displayName: null;
      internalContactEmail: null;
      internalContactUserId: null;
    };

export function toResponsiblePublicDto(
  profile: ResponsibleProfileState,
): ResponsiblePublicDto {
  if (profile.state === "confirmed") {
    return {
      state: "confirmed",
      displayName: profile.displayName,
      internalContactEmail: profile.email,
      internalContactUserId: profile.lkUserId,
    };
  }
  return {
    state: "unknown",
    displayName: null,
    internalContactEmail: null,
    internalContactUserId: null,
  };
}
