import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "./onec-clients-employee-roster-fixtures";

/** Synthetic GUIDs mirroring owner hierarchy (apex GUID matches canonical director). */
export const FLAT_ORG = {
  APEX: "a2bacfab-ebec-11e3-a1dd-08606e7fce4d",
  TEAM_APEX: "01010101-0101-4101-8101-010101010101",
  KOMKOV: "77777777-7777-4777-8777-777777777777",
  TEAM_KOMKOV: "88888888-8888-4888-8888-888888888888",
  STRELNikov: "99999999-9999-4999-8999-999999999999",
  ROGOLEV: "02020202-0202-4202-8202-020202020202",
  TEAM_ROGOLEV: "02020202-0202-4202-8202-020202020201",
  SAKALUSH: "02020202-0202-4202-8202-020202020203",
  TALIURI: "03030303-0303-4303-8303-030303030302",
  TEAM_TALIURI: "03030303-0303-4303-8303-030303030301",
  MOROZOVA: "04040404-0404-4404-8404-040404040402",
  SKALABAN: "05050505-0505-4505-8505-050505050502",
  TEAM_SKALABAN: "05050505-0505-4505-8505-050505050501",
  GUSLEVA: "11111111-1111-4111-8111-111111111111",
  TEAM_GUSLEVA: "22222222-2222-4222-8222-222222222222",
  ARTYUR: "33333333-3333-4333-8333-333333333333",
  KOTENEVA: "44444444-4444-4444-8444-444444444444",
  ZAKHARCHENKO: "55555555-5555-4555-8555-555555555555",
  BURGUTINA: "66666666-6666-4666-8666-666666666666",
  SAPOZHKOV: "07070707-0707-4707-8707-070707070702",
  TEAM_SAPOZHKOV: "07070707-0707-4707-8707-070707070701",
  KUPIANSKY: "08080808-0808-4808-8808-080808080802",
  TEAM_KUPIANSKY: "08080808-0808-4808-8808-080808080801",
} as const;

export const FLAT_ORG_APEX_TEAM_LEADER_GUIDS = [
  FLAT_ORG.KOMKOV,
  FLAT_ORG.ROGOLEV,
  FLAT_ORG.TALIURI,
  FLAT_ORG.MOROZOVA,
  FLAT_ORG.SKALABAN,
  FLAT_ORG.GUSLEVA,
  FLAT_ORG.SAPOZHKOV,
  FLAT_ORG.KUPIANSKY,
] as const;

export const FLAT_ORG_GUSLEVA_MEMBER_GUIDS = [
  FLAT_ORG.ARTYUR,
  FLAT_ORG.KOTENEVA,
  FLAT_ORG.ZAKHARCHENKO,
  FLAT_ORG.BURGUTINA,
] as const;

export const FLAT_ORG_EXPECTED_TEAM_GUIDS = [
  FLAT_ORG.TEAM_APEX,
  FLAT_ORG.TEAM_KOMKOV,
  FLAT_ORG.TEAM_ROGOLEV,
  FLAT_ORG.TEAM_TALIURI,
  FLAT_ORG.TEAM_SKALABAN,
  FLAT_ORG.TEAM_GUSLEVA,
  FLAT_ORG.TEAM_SAPOZHKOV,
  FLAT_ORG.TEAM_KUPIANSKY,
] as const;

function flatEmptyTeam() {
  return {
    guid_team: null,
    name_team: null,
    guid_team_leader: null,
    name_team_leader: null,
  };
}

function flatMember(teamGuid: string, teamName: string, leaderGuid: string, leaderName: string) {
  return {
    guid_team: teamGuid,
    name_team: teamName,
    guid_team_leader: leaderGuid,
    name_team_leader: leaderName,
  };
}

function apexTeamMember(leaderGuid: string, leaderName: string, post?: string) {
  return buildEmployeeRosterEntry(leaderGuid, {
    name_manager: leaderName,
    post: post ?? "Team Leader",
    ...flatMember(FLAT_ORG.TEAM_APEX, "Director Team", FLAT_ORG.APEX, "Apex Leader"),
  });
}

function subTeamMember(
  guid: string,
  name: string,
  teamGuid: string,
  teamName: string,
  leaderGuid: string,
  leaderName: string,
  post?: string,
) {
  return buildEmployeeRosterEntry(guid, {
    name_manager: name,
    post: post ?? "Member",
    ...flatMember(teamGuid, teamName, leaderGuid, leaderName),
  });
}

/** Owner-confirmed Gusleva mini slice: apex team + Gusleva/Komkov leaders + 4 Gusleva members + Strelnikov. */
export function buildFlatOrgHierarchyRosterBytes(): Buffer {
  return buildEmployeeRosterBytes([
    buildEmployeeRosterEntry(FLAT_ORG.APEX, {
      name_manager: "Apex Leader",
      ...flatEmptyTeam(),
    }),
    apexTeamMember(FLAT_ORG.GUSLEVA, "Gusleva Leader", "Менеджер по продажам"),
    apexTeamMember(FLAT_ORG.KOMKOV, "Komkov Leader"),
    ...FLAT_ORG_GUSLEVA_MEMBER_GUIDS.map((guid, index) =>
      subTeamMember(
        guid,
        `Gusleva Member ${index + 1}`,
        FLAT_ORG.TEAM_GUSLEVA,
        "Gusleva Team",
        FLAT_ORG.GUSLEVA,
        "Gusleva Leader",
        index === 0 ? "Assistant" : undefined,
      ),
    ),
    subTeamMember(
      FLAT_ORG.STRELNikov,
      "Strelnikov Member",
      FLAT_ORG.TEAM_KOMKOV,
      "Komkov Team",
      FLAT_ORG.KOMKOV,
      "Komkov Leader",
    ),
  ]);
}

/** Full synthetic flat snapshot: 40 employees, 8 groups, 39 memberships. */
export function buildFullFlatOrgHierarchyRosterBytes(): Buffer {
  const entries = [
    buildEmployeeRosterEntry(FLAT_ORG.APEX, {
      name_manager: "Apex Leader",
      ...flatEmptyTeam(),
    }),
    apexTeamMember(FLAT_ORG.KOMKOV, "Komkov Leader"),
    apexTeamMember(FLAT_ORG.ROGOLEV, "Rogolev Leader"),
    apexTeamMember(FLAT_ORG.TALIURI, "Taliuri Leader"),
    apexTeamMember(FLAT_ORG.MOROZOVA, "Morozova Leader"),
    apexTeamMember(FLAT_ORG.SKALABAN, "Skalaban Leader"),
    apexTeamMember(FLAT_ORG.GUSLEVA, "Gusleva Leader", "Менеджер по продажам"),
    apexTeamMember(FLAT_ORG.SAPOZHKOV, "Sapozhkov Leader"),
    apexTeamMember(FLAT_ORG.KUPIANSKY, "Kupiansky Leader"),
    subTeamMember(
      FLAT_ORG.STRELNikov,
      "Strelnikov Member",
      FLAT_ORG.TEAM_KOMKOV,
      "Komkov Team",
      FLAT_ORG.KOMKOV,
      "Komkov Leader",
    ),
    subTeamMember(
      FLAT_ORG.SAKALUSH,
      "Sakalush Member",
      FLAT_ORG.TEAM_ROGOLEV,
      "Rogolev Team",
      FLAT_ORG.ROGOLEV,
      "Rogolev Leader",
    ),
    subTeamMember("03030303-0303-4303-8303-030303030303", "Bogachev Member", FLAT_ORG.TEAM_TALIURI, "Taliuri Team", FLAT_ORG.TALIURI, "Taliuri Leader"),
    subTeamMember("03030303-0303-4303-8303-030303030304", "Dzodzikov Member", FLAT_ORG.TEAM_TALIURI, "Taliuri Team", FLAT_ORG.TALIURI, "Taliuri Leader"),
    subTeamMember("03030303-0303-4303-8303-030303030305", "Drogobitsky Member", FLAT_ORG.TEAM_TALIURI, "Taliuri Team", FLAT_ORG.TALIURI, "Taliuri Leader"),
    subTeamMember("03030303-0303-4303-8303-030303030306", "Melnik Member", FLAT_ORG.TEAM_TALIURI, "Taliuri Team", FLAT_ORG.TALIURI, "Taliuri Leader"),
    subTeamMember("05050505-0505-4505-8505-050505050503", "Lysenko Member", FLAT_ORG.TEAM_SKALABAN, "Skalaban Team", FLAT_ORG.SKALABAN, "Skalaban Leader"),
    subTeamMember("05050505-0505-4505-8505-050505050504", "Miroshnichenko Member", FLAT_ORG.TEAM_SKALABAN, "Skalaban Team", FLAT_ORG.SKALABAN, "Skalaban Leader"),
    subTeamMember("05050505-0505-4505-8505-050505050505", "Doronina Member", FLAT_ORG.TEAM_SKALABAN, "Skalaban Team", FLAT_ORG.SKALABAN, "Skalaban Leader"),
    subTeamMember("05050505-0505-4505-8505-050505050506", "Agadzhanyan Member", FLAT_ORG.TEAM_SKALABAN, "Skalaban Team", FLAT_ORG.SKALABAN, "Skalaban Leader"),
    subTeamMember("05050505-0505-4505-8505-050505050507", "Ilyuchenko Member", FLAT_ORG.TEAM_SKALABAN, "Skalaban Team", FLAT_ORG.SKALABAN, "Skalaban Leader"),
    subTeamMember("05050505-0505-4505-8505-050505050508", "Kulakova Member", FLAT_ORG.TEAM_SKALABAN, "Skalaban Team", FLAT_ORG.SKALABAN, "Skalaban Leader"),
    ...FLAT_ORG_GUSLEVA_MEMBER_GUIDS.map((guid, index) =>
      subTeamMember(
        guid,
        `Gusleva Member ${index + 1}`,
        FLAT_ORG.TEAM_GUSLEVA,
        "Gusleva Team",
        FLAT_ORG.GUSLEVA,
        "Gusleva Leader",
        index === 0 ? "Assistant" : undefined,
      ),
    ),
    subTeamMember("07070707-0707-4707-8707-070707070703", "Yarysh Member", FLAT_ORG.TEAM_SAPOZHKOV, "Sapozhkov Team", FLAT_ORG.SAPOZHKOV, "Sapozhkov Leader"),
    subTeamMember("07070707-0707-4707-8707-070707070704", "Litvinova Member", FLAT_ORG.TEAM_SAPOZHKOV, "Sapozhkov Team", FLAT_ORG.SAPOZHKOV, "Sapozhkov Leader"),
    subTeamMember("07070707-0707-4707-8707-070707070705", "Repina Member", FLAT_ORG.TEAM_SAPOZHKOV, "Sapozhkov Team", FLAT_ORG.SAPOZHKOV, "Sapozhkov Leader"),
    subTeamMember("07070707-0707-4707-8707-070707070706", "Osmanov Member", FLAT_ORG.TEAM_SAPOZHKOV, "Sapozhkov Team", FLAT_ORG.SAPOZHKOV, "Sapozhkov Leader"),
    subTeamMember("07070707-0707-4707-8707-070707070707", "Petrichenko Member", FLAT_ORG.TEAM_SAPOZHKOV, "Sapozhkov Team", FLAT_ORG.SAPOZHKOV, "Sapozhkov Leader"),
    subTeamMember("07070707-0707-4707-8707-070707070708", "Netkacheva Member", FLAT_ORG.TEAM_SAPOZHKOV, "Sapozhkov Team", FLAT_ORG.SAPOZHKOV, "Sapozhkov Leader"),
    subTeamMember("07070707-0707-4707-8707-070707070709", "Arutyunyan Member", FLAT_ORG.TEAM_SAPOZHKOV, "Sapozhkov Team", FLAT_ORG.SAPOZHKOV, "Sapozhkov Leader"),
    subTeamMember("07070707-0707-4707-8707-070707070710", "Chernousova Member", FLAT_ORG.TEAM_SAPOZHKOV, "Sapozhkov Team", FLAT_ORG.SAPOZHKOV, "Sapozhkov Leader"),
    subTeamMember("08080808-0808-4808-8808-080808080803", "Ponkratova Member", FLAT_ORG.TEAM_KUPIANSKY, "Kupiansky Team", FLAT_ORG.KUPIANSKY, "Kupiansky Leader"),
    subTeamMember("08080808-0808-4808-8808-080808080804", "Boyko Member", FLAT_ORG.TEAM_KUPIANSKY, "Kupiansky Team", FLAT_ORG.KUPIANSKY, "Kupiansky Leader"),
    subTeamMember("08080808-0808-4808-8808-080808080805", "Yakubova Member", FLAT_ORG.TEAM_KUPIANSKY, "Kupiansky Team", FLAT_ORG.KUPIANSKY, "Kupiansky Leader"),
    subTeamMember("08080808-0808-4808-8808-080808080806", "Fedotov Member", FLAT_ORG.TEAM_KUPIANSKY, "Kupiansky Team", FLAT_ORG.KUPIANSKY, "Kupiansky Leader"),
    subTeamMember("08080808-0808-4808-8808-080808080807", "Sklyarov Member", FLAT_ORG.TEAM_KUPIANSKY, "Kupiansky Team", FLAT_ORG.KUPIANSKY, "Kupiansky Leader"),
    subTeamMember("08080808-0808-4808-8808-080808080808", "Orlov Member", FLAT_ORG.TEAM_KUPIANSKY, "Kupiansky Team", FLAT_ORG.KUPIANSKY, "Kupiansky Leader"),
    subTeamMember("08080808-0808-4808-8808-080808080809", "Avetisyan Member", FLAT_ORG.TEAM_KUPIANSKY, "Kupiansky Team", FLAT_ORG.KUPIANSKY, "Kupiansky Leader"),
  ];

  return buildEmployeeRosterBytes(entries);
}

export const FULL_FLAT_ORG_EXPECTED = {
  employeeCount: 40,
  teamGroupCount: 8,
  membershipCount: 39,
  miniEmployeeCount: 8,
  miniTeamGroupCount: 3,
  miniMembershipCount: 7,
} as const;
