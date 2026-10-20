import { buildEmployeeRosterBytes, buildEmployeeRosterEntry } from "./onec-clients-employee-roster-fixtures";

/** Synthetic GUIDs mirroring owner hierarchy (not production identities except apex pattern). */
export const FLAT_ORG = {
  APEX: "a2bacfab-ebec-11e3-a1dd-08606e7fce4d",
  GUSLEVA: "11111111-1111-4111-8111-111111111111",
  TEAM_GUSLEVA: "22222222-2222-4222-8222-222222222222",
  ARTYUR: "33333333-3333-4333-8333-333333333333",
  KOTENEVA: "44444444-4444-4444-8444-444444444444",
  ZAKHARCHENKO: "55555555-5555-4555-8555-555555555555",
  BURGUTINA: "66666666-6666-4666-8666-666666666666",
  KOMKOV: "77777777-7777-4777-8777-777777777777",
  TEAM_KOMKOV: "88888888-8888-4888-8888-888888888888",
  STRELNikov: "99999999-9999-4999-8999-999999999999",
} as const;

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

type FlatTeamSpec = {
  teamGuid: string;
  teamName: string;
  leaderGuid: string;
  leaderName: string;
  leaderPost?: string;
  members: { guid: string; name: string; post?: string }[];
};

const FULL_FLAT_TEAMS: FlatTeamSpec[] = [
  {
    teamGuid: FLAT_ORG.TEAM_KOMKOV,
    teamName: "Komkov Team",
    leaderGuid: FLAT_ORG.KOMKOV,
    leaderName: "Komkov Leader",
    members: [{ guid: FLAT_ORG.STRELNikov, name: "Strelnikov Member" }],
  },
  {
    teamGuid: "02020202-0202-4202-8202-020202020201",
    teamName: "Rogolev Team",
    leaderGuid: "02020202-0202-4202-8202-020202020202",
    leaderName: "Rogolev",
    members: [{ guid: "02020202-0202-4202-8202-020202020203", name: "Sakalush" }],
  },
  {
    teamGuid: "03030303-0303-4303-8303-030303030301",
    teamName: "Taliuri Team",
    leaderGuid: "03030303-0303-4303-8303-030303030302",
    leaderName: "Taliuri",
    members: [
      { guid: "03030303-0303-4303-8303-030303030303", name: "Bogachev" },
      { guid: "03030303-0303-4303-8303-030303030304", name: "Dzodzikov" },
      { guid: "03030303-0303-4303-8303-030303030305", name: "Drogobitsky" },
      { guid: "03030303-0303-4303-8303-030303030306", name: "Melnik" },
    ],
  },
  {
    teamGuid: "04040404-0404-4404-8404-040404040401",
    teamName: "Morozova Team",
    leaderGuid: "04040404-0404-4404-8404-040404040402",
    leaderName: "Morozova",
    members: [],
  },
  {
    teamGuid: "05050505-0505-4505-8505-050505050501",
    teamName: "Skalaban Team",
    leaderGuid: "05050505-0505-4505-8505-050505050502",
    leaderName: "Skalaban",
    members: [
      { guid: "05050505-0505-4505-8505-050505050503", name: "Lysenko" },
      { guid: "05050505-0505-4505-8505-050505050504", name: "Miroshnichenko" },
      { guid: "05050505-0505-4505-8505-050505050505", name: "Doronina" },
      { guid: "05050505-0505-4505-8505-050505050506", name: "Agadzhanyan" },
      { guid: "05050505-0505-4505-8505-050505050507", name: "Ilyuchenko" },
      { guid: "05050505-0505-4505-8505-050505050508", name: "Kulakova" },
    ],
  },
  {
    teamGuid: FLAT_ORG.TEAM_GUSLEVA,
    teamName: "Gusleva Team",
    leaderGuid: FLAT_ORG.GUSLEVA,
    leaderName: "Gusleva Leader",
    leaderPost: "Менеджер по продажам",
    members: [
      { guid: FLAT_ORG.ARTYUR, name: "Artyur Member", post: "Assistant" },
      { guid: FLAT_ORG.KOTENEVA, name: "Koteneva Member" },
      { guid: FLAT_ORG.ZAKHARCHENKO, name: "Zakharchenko Member" },
      { guid: FLAT_ORG.BURGUTINA, name: "Burgutina Member" },
    ],
  },
  {
    teamGuid: "07070707-0707-4707-8707-070707070701",
    teamName: "Sapozhkov Team",
    leaderGuid: "07070707-0707-4707-8707-070707070702",
    leaderName: "Sapozhkov",
    members: [
      { guid: "07070707-0707-4707-8707-070707070703", name: "Yarysh" },
      { guid: "07070707-0707-4707-8707-070707070704", name: "Litvinova" },
      { guid: "07070707-0707-4707-8707-070707070705", name: "Repina" },
      { guid: "07070707-0707-4707-8707-070707070706", name: "Osmanov" },
      { guid: "07070707-0707-4707-8707-070707070707", name: "Petrichenko" },
      { guid: "07070707-0707-4707-8707-070707070708", name: "Netkacheva" },
      { guid: "07070707-0707-4707-8707-070707070709", name: "Arutyunyan" },
      { guid: "07070707-0707-4707-8707-070707070710", name: "Chernousova" },
    ],
  },
  {
    teamGuid: "08080808-0808-4808-8808-080808080801",
    teamName: "Kupiansky Team",
    leaderGuid: "08080808-0808-4808-8808-080808080802",
    leaderName: "Kupiansky",
    members: [
      { guid: "08080808-0808-4808-8808-080808080803", name: "Ponkratova" },
      { guid: "08080808-0808-4808-8808-080808080804", name: "Boyko" },
      { guid: "08080808-0808-4808-8808-080808080805", name: "Yakubova" },
      { guid: "08080808-0808-4808-8808-080808080806", name: "Fedotov" },
      { guid: "08080808-0808-4808-8808-080808080807", name: "Sklyarov" },
      { guid: "08080808-0808-4808-8808-080808080808", name: "Orlov" },
      { guid: "08080808-0808-4808-8808-080808080809", name: "Avetisyan" },
    ],
  },
];

function teamRows(spec: FlatTeamSpec) {
  const flat = flatMember(spec.teamGuid, spec.teamName, spec.leaderGuid, spec.leaderName);
  const rows = [
    buildEmployeeRosterEntry(spec.leaderGuid, {
      name_manager: spec.leaderName,
      post: spec.leaderPost ?? "Team Leader",
      ...flat,
    }),
    ...spec.members.map((member) =>
      buildEmployeeRosterEntry(member.guid, {
        name_manager: member.name,
        post: member.post ?? "Member",
        ...flat,
      }),
    ),
  ];
  return rows;
}

/** Owner-confirmed Gusleva team: leader post is sales manager, members are not filtered by post. */
export function buildFlatOrgHierarchyRosterBytes(): Buffer {
  return buildEmployeeRosterBytes([
    buildEmployeeRosterEntry(FLAT_ORG.APEX, {
      name_manager: "Apex Leader",
      ...flatEmptyTeam(),
    }),
    ...FULL_FLAT_TEAMS.filter(
      (t) => t.teamGuid === FLAT_ORG.TEAM_GUSLEVA || t.teamGuid === FLAT_ORG.TEAM_KOMKOV,
    ).flatMap(teamRows),
  ]);
}

/** Full synthetic flat snapshot: 40 employees, 8 groups, 39 memberships, one apex without team. */
export function buildFullFlatOrgHierarchyRosterBytes(): Buffer {
  return buildEmployeeRosterBytes([
    buildEmployeeRosterEntry(FLAT_ORG.APEX, {
      name_manager: "Apex Leader",
      ...flatEmptyTeam(),
    }),
    ...FULL_FLAT_TEAMS.flatMap(teamRows),
  ]);
}

export const FULL_FLAT_ORG_EXPECTED = {
  employeeCount: 40,
  teamGroupCount: 8,
  membershipCount: 39,
} as const;
