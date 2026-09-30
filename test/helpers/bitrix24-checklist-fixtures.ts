export function sampleChecklistRootGroup(id = "431", title = "Чек-лист 1") {
  return {
    ID: id,
    TASK_ID: "9001",
    PARENT_ID: 0,
    CREATED_BY: "503",
    TITLE: title,
    SORT_INDEX: "0",
    IS_COMPLETE: "N",
    IS_IMPORTANT: "N",
    TOGGLED_BY: null,
    TOGGLED_DATE: "",
    MEMBERS: [],
    ATTACHMENTS: [],
  };
}

export function sampleChecklistItem(input: {
  id: string;
  parentId: string;
  title: string;
  sortIndex?: string;
  isComplete?: "Y" | "N";
  members?: Array<{ ID: string; TYPE: "U" | "A"; NAME: string }>;
}) {
  return {
    ID: input.id,
    TASK_ID: "9001",
    PARENT_ID: input.parentId,
    CREATED_BY: "503",
    TITLE: input.title,
    SORT_INDEX: input.sortIndex ?? "0",
    IS_COMPLETE: input.isComplete ?? "N",
    IS_IMPORTANT: "N",
    TOGGLED_BY: null,
    TOGGLED_DATE: "",
    MEMBERS: input.members ?? [],
    ATTACHMENTS: [],
  };
}

export function sampleNestedChecklistResponse() {
  return [
    sampleChecklistRootGroup(),
    sampleChecklistItem({ id: "433", parentId: "431", title: "Найти документы", sortIndex: "0", isComplete: "Y" }),
    sampleChecklistItem({ id: "447", parentId: "431", title: "Согласовать детали", sortIndex: "1" }),
    sampleChecklistItem({ id: "471", parentId: "447", title: "Подготовить решение", sortIndex: "1" }),
    sampleChecklistItem({ id: "485", parentId: "447", title: "Назначить встречу", sortIndex: "0", isComplete: "Y" }),
  ];
}
