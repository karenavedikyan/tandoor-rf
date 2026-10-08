(function () {
  "use strict";

  var api = window.TandoorRf;
  var shell = window.ClientsShell;
  var logic = window.ClientsLogic;
  var DEBOUNCE_MS = 300;

  var appEl = document.getElementById("clients-app");
  var accessPanel = document.getElementById("access-panel");
  var initPanel = document.getElementById("init-panel");
  var searchInput = document.getElementById("search-input");
  var ropFilterWrap = document.getElementById("rop-filter-wrap");
  var ropFilter = document.getElementById("rop-filter");
  var ropFilterInput = document.getElementById("rop-filter-input");
  var ropFilterList = document.getElementById("rop-filter-list");
  var ropFilterMode = document.getElementById("rop-filter-mode");
  var ropFilterTags = document.getElementById("rop-filter-tags");
  var managerFilter = document.getElementById("manager-filter");
  var managerFilterInput = document.getElementById("manager-filter-input");
  var managerFilterList = document.getElementById("manager-filter-list");
  var managerFilterMode = document.getElementById("manager-filter-mode");
  var managerFilterTags = document.getElementById("manager-filter-tags");
  var holdingFilter = document.getElementById("holding-filter");
  var holdingFilterInput = document.getElementById("holding-filter-input");
  var holdingFilterList = document.getElementById("holding-filter-list");
  var phoneFilter = document.getElementById("phone-filter");
  var resetFiltersBtn = document.getElementById("reset-filters");
  var resultCountEl = document.getElementById("result-count");
  var syncStatusEl = document.getElementById("sync-status");
  var onecUpdatePanelEl = document.getElementById("onec-update-panel");
  var onecUpdateButtonEl = document.getElementById("onec-update-button");
  var onecUpdateStatusEl = document.getElementById("onec-update-status");
  var onecUpdateMetaEl = document.getElementById("onec-update-meta");
  var onecUpdatePollTimer = null;
  var resultsStateEl = document.getElementById("results-state");
  var resultsContentEl = document.getElementById("results-content");
  var tableBody = document.getElementById("clients-table-body");
  var cardsEl = document.getElementById("clients-cards");
  var paginationEl = document.getElementById("pagination");
  var viewSwitcherEl = document.getElementById("view-switcher");
  var entitySwitcherEl = document.getElementById("entity-switcher");
  var pageTitleEl = document.getElementById("clients-page-title");
  var pageSubtitleEl = document.getElementById("clients-page-subtitle");
  var managerChromeEl = document.getElementById("clients-manager-chrome");
  var employeeAvatarEl = document.getElementById("clients-employee-avatar");
  var employeeNameEl = document.getElementById("clients-employee-name");
  var employeeRoleEl = document.getElementById("clients-employee-role");
  var statClientsEl = document.getElementById("clients-stat-clients");
  var statOutletsEl = document.getElementById("clients-stat-outlets");
  var statNoOutletsEl = document.getElementById("clients-stat-no-outlets");
  var statClientsLabelEl = document.getElementById("clients-stat-clients-label");
  var statOutletsLabelEl = document.getElementById("clients-stat-outlets-label");
  var statNoOutletsWrapEl = document.getElementById("clients-stat-no-outlets-wrap");
  var statNoOutletsLabelEl = document.getElementById("clients-stat-no-outlets-label");
  var statsStripEl = document.getElementById("clients-stats-strip");
  var incompleteStatsStripEl = document.getElementById("clients-stats-incomplete-strip");
  var incompleteStatsCompactEl = document.getElementById("clients-stats-incomplete-compact");
  var statIncompleteClientsEl = document.getElementById("clients-stat-incomplete-clients");
  var statIncompleteOutletsEl = document.getElementById("clients-stat-incomplete-outlets");
  var statIncompleteCompactClientsEl = document.getElementById("clients-stat-incomplete-compact-clients");
  var statIncompleteCompactOutletsEl = document.getElementById("clients-stat-incomplete-compact-outlets");
  var statIncompleteCompactLinkEl = document.getElementById("clients-stat-incomplete-compact-link");
  var employeeScopeValueEl = document.getElementById("clients-employee-scope-value");
  var filtersScopeLabelEl = document.getElementById("clients-filters-scope-label");
  var workspaceNavEl = document.querySelector(".clients-workspace-nav");
  var workspaceNavTabEl = document.getElementById("clients-workspace-nav-tab");
  var viewAllTabEl = viewSwitcherEl?.querySelector('[data-view="all"]');
  var viewTeamsTabEl = viewSwitcherEl?.querySelector('[data-view="teams"]');
  var breadcrumbsRowEl = document.getElementById("clients-breadcrumbs-row");
  var viewReviewTab = document.getElementById("view-review-tab");
  var viewCompletenessTab = document.getElementById("view-completeness-tab");
  var tableHeadRow = document.getElementById("clients-table-head-row");
  var breadcrumbsEl = document.getElementById("clients-breadcrumbs");
  var teamsPanelEl = document.getElementById("teams-panel");
  var unassignedPanelEl = document.getElementById("unassigned-panel");
  var outletsFilterWrap = document.getElementById("outlets-filter-wrap");
  var outletsFilter = document.getElementById("outlets-filter");
  var outletStatusFilterWrap = document.getElementById("outlet-status-filter-wrap");
  var outletStatusFilter = document.getElementById("outlet-status-filter");
  var warehouseFilterWrap = document.getElementById("warehouse-filter-wrap");
  var warehouseFilter = document.getElementById("warehouse-filter");
  var regionalFilterWrap = document.getElementById("regional-filter-wrap");
  var regionalFilter = document.getElementById("regional-filter");
  var regionalFilterInput = document.getElementById("regional-filter-input");
  var regionalFilterList = document.getElementById("regional-filter-list");
  var regionalFilterMode = document.getElementById("regional-filter-mode");
  var regionalFilterTags = document.getElementById("regional-filter-tags");
  var hardwareFilterWrap = document.getElementById("hardware-filter-wrap");
  var hardwareFilter = document.getElementById("hardware-filter");
  var hardwareFilterInput = document.getElementById("hardware-filter-input");
  var hardwareFilterList = document.getElementById("hardware-filter-list");
  var hardwareFilterMode = document.getElementById("hardware-filter-mode");
  var hardwareFilterTags = document.getElementById("hardware-filter-tags");
  var outletManagerFilterWrap = document.getElementById("outlet-manager-filter-wrap");
  var outletManagerFilter = document.getElementById("outlet-manager-filter");
  var outletManagerFilterInput = document.getElementById("outlet-manager-filter-input");
  var outletManagerFilterList = document.getElementById("outlet-manager-filter-list");
  var outletManagerFilterMode = document.getElementById("outlet-manager-filter-mode");
  var outletManagerFilterTags = document.getElementById("outlet-manager-filter-tags");
  var outletRegionalFilterWrap = document.getElementById("outlet-regional-filter-wrap");
  var outletRegionalFilter = document.getElementById("outlet-regional-filter");
  var outletRegionalFilterInput = document.getElementById("outlet-regional-filter-input");
  var outletRegionalFilterList = document.getElementById("outlet-regional-filter-list");
  var outletRegionalFilterMode = document.getElementById("outlet-regional-filter-mode");
  var outletRegionalFilterTags = document.getElementById("outlet-regional-filter-tags");
  var outletHardwareFilterWrap = document.getElementById("outlet-hardware-filter-wrap");
  var outletHardwareFilter = document.getElementById("outlet-hardware-filter");
  var outletHardwareFilterInput = document.getElementById("outlet-hardware-filter-input");
  var outletHardwareFilterList = document.getElementById("outlet-hardware-filter-list");
  var outletHardwareFilterMode = document.getElementById("outlet-hardware-filter-mode");
  var outletHardwareFilterTags = document.getElementById("outlet-hardware-filter-tags");
  var outletRopFilterWrap = document.getElementById("outlet-rop-filter-wrap");
  var outletRopFilter = document.getElementById("outlet-rop-filter");
  var outletRopFilterInput = document.getElementById("outlet-rop-filter-input");
  var outletRopFilterList = document.getElementById("outlet-rop-filter-list");
  var outletRopFilterMode = document.getElementById("outlet-rop-filter-mode");
  var outletRopFilterTags = document.getElementById("outlet-rop-filter-tags");
  var fieldFiltersWrap = document.getElementById("field-filters-wrap");
  var routeDirectionFilter = document.getElementById("route-direction-filter");
  var storeAddressFilter = document.getElementById("store-address-filter");
  var storePhoneFilter = document.getElementById("store-phone-filter");
  var accountantPhoneFilter = document.getElementById("accountant-phone-filter");
  var accountantEmailFilter = document.getElementById("accountant-email-filter");
  var loadingTimeFilter = document.getElementById("loading-time-filter");
  var loadingScheduleFilter = document.getElementById("loading-schedule-filter");
  var filledFieldFilter = document.getElementById("filled-field-filter");
  var emptyFieldFilter = document.getElementById("empty-field-filter");
  var discountProgramFilter = document.getElementById("discount-program-filter");
  var onecTop150Filter = document.getElementById("onec-top150-filter");
  var onecCategoryFilter = document.getElementById("onec-category-filter");
  var onecCounterpartyFilter = document.getElementById("onec-counterparty-filter");
  var onecFullNameFilter = document.getElementById("onec-full-name-filter");
  var onecLegalTypeFilter = document.getElementById("onec-legal-type-filter");
  var onecOgrnFilter = document.getElementById("onec-ogrn-filter");
  var onecPrimaryContractFilter = document.getElementById("onec-primary-contract-filter");
  var onecMainAgreementFilter = document.getElementById("onec-main-agreement-filter");
  var discountAmountMinFilter = document.getElementById("discount-amount-min-filter");
  var discountAmountMaxFilter = document.getElementById("discount-amount-max-filter");
  var markupNameFilter = document.getElementById("markup-name-filter");
  var markupPercentageFilter = document.getElementById("markup-percentage-filter");
  var bonusTandoorFilter = document.getElementById("bonus-tandoor-filter");
  var lprNameFilter = document.getElementById("lpr-name-filter");
  var lprPostFilter = document.getElementById("lpr-post-filter");
  var lprPhoneFilter = document.getElementById("lpr-phone-filter");
  var lprEmailFilter = document.getElementById("lpr-email-filter");
  var lprBonusFilter = document.getElementById("lpr-bonus-filter");
  var lprConditionsFilter = document.getElementById("lpr-conditions-filter");
  var lprDobFilter = document.getElementById("lpr-dob-filter");
  var lprDobFromFilter = document.getElementById("lpr-dob-from-filter");
  var lprDobToFilter = document.getElementById("lpr-dob-to-filter");
  var ropFilterLabelEl = document.getElementById("rop-filter-label");
  var managerFilterLabelEl = document.getElementById("manager-filter-label");
  var regionalFilterLabelEl = document.getElementById("regional-filter-label");
  var hardwareFilterLabelEl = document.getElementById("hardware-filter-label");
  var tandoorFilterWrap = document.getElementById("tandoor-filter-wrap");
  var tandoorFilter = document.getElementById("tandoor-filter");
  var reviewStateFilterWrap = document.getElementById("review-state-filter-wrap");
  var reviewStateFilter = document.getElementById("review-state-filter");
  var reviewDecisionFilterWrap = document.getElementById("review-decision-filter-wrap");
  var reviewDecisionFilter = document.getElementById("review-decision-filter");
  var unassignedFilterWrap = document.getElementById("unassigned-filter-wrap");
  var unassignedFilter = document.getElementById("unassigned-filter");
  var completenessReasonFilterWrap = document.getElementById("completeness-reason-filter-wrap");
  var completenessReasonFilter = document.getElementById("completeness-reason-filter");
  var managerFilterWrap = document.getElementById("manager-filter-wrap");
  var holdingFilterWrap = document.getElementById("holding-filter-wrap");
  var resultsTitleEl = document.getElementById("clients-results-title");
  var filtersToggleBtn = document.getElementById("clients-filters-toggle");
  var filtersPanelEl = document.getElementById("clients-filters-panel");
  var filtersActiveCountEl = document.getElementById("clients-filters-active-count");
  var columnsPickerBtn = document.getElementById("columns-picker-btn");
  var columnsPickerEl = document.getElementById("columns-picker");
  var visibleColumnIds = [];

  var debounceTimer = null;
  var activeRequestId = 0;
  var listFetchAbortController = null;
  var managerOptions = [];
  var outletManagerOptions = [];
  var holdingOptions = [];
  var regionalOptions = [];
  var hardwareOptions = [];
  var ropOptions = [];
  var managerCombobox = null;
  var holdingCombobox = null;
  var regionalCombobox = null;
  var hardwareCombobox = null;
  var ropCombobox = null;
  var outletManagerCombobox = null;
  var outletRegionalCombobox = null;
  var outletHardwareCombobox = null;
  var outletRopCombobox = null;

  var MANAGER_ASSIGNMENT_KEYS = {
    clients: {
      guid: "clientManager",
      mode: "clientManagerMode",
      missing: "missingClientManager",
      legacyGuid: "manager",
      legacyMissing: "missingManager",
    },
    outlets: {
      guid: "outletManager",
      mode: "outletManagerMode",
      missing: "missingOutletManager",
      legacyGuid: "manager",
      legacyMissing: "missingManager",
    },
  };
  var REGIONAL_ASSIGNMENT_KEYS = {
    clients: {
      guid: "clientRegionalManager",
      mode: "clientRegionalManagerMode",
      missing: "missingClientRegional",
      legacyGuid: "regionalManager",
      legacyMissing: "missingRegional",
    },
    outlets: {
      guid: "outletRegionalManager",
      mode: "outletRegionalManagerMode",
      missing: "missingOutletRegional",
      legacyGuid: "regionalManager",
      legacyMissing: "missingRegional",
    },
  };
  var HARDWARE_ASSIGNMENT_KEYS = {
    clients: {
      guid: "clientHardwareManager",
      mode: "clientHardwareManagerMode",
      missing: "missingClientHardware",
      legacyGuid: "hardwareManager",
      legacyMissing: "missingHardware",
    },
    outlets: {
      guid: "outletHardwareManager",
      mode: "outletHardwareManagerMode",
      missing: "missingOutletHardware",
      legacyGuid: "hardwareManager",
      legacyMissing: "missingHardware",
    },
  };
  var ROP_ASSIGNMENT_KEYS = {
    clients: {
      guid: "clientRopEmployee",
      mode: "clientRopEmployeeMode",
      missing: "missingClientRop",
      legacyGuid: "ropEmployee",
      legacyMissing: "missingRop",
    },
    outlets: {
      guid: "outletRopEmployee",
      mode: "outletRopEmployeeMode",
      missing: "missingOutletRop",
      legacyGuid: "ropEmployee",
      legacyMissing: "missingRop",
    },
  };
  var OUTLET_MANAGER_ASSIGNMENT_KEYS = {
    clients: {
      guid: "outletManager",
      mode: "outletManagerMode",
      missing: "missingOutletManager",
    },
    outlets: {
      guid: "outletManager",
      mode: "outletManagerMode",
      missing: "missingOutletManager",
    },
  };
  var OUTLET_REGIONAL_ASSIGNMENT_KEYS = {
    clients: {
      guid: "outletRegionalManager",
      mode: "outletRegionalManagerMode",
      missing: "missingOutletRegional",
    },
    outlets: {
      guid: "outletRegionalManager",
      mode: "outletRegionalManagerMode",
      missing: "missingOutletRegional",
    },
  };
  var OUTLET_HARDWARE_ASSIGNMENT_KEYS = {
    clients: {
      guid: "outletHardwareManager",
      mode: "outletHardwareManagerMode",
      missing: "missingOutletHardware",
    },
    outlets: {
      guid: "outletHardwareManager",
      mode: "outletHardwareManagerMode",
      missing: "missingOutletHardware",
    },
  };
  var OUTLET_ROP_ASSIGNMENT_KEYS = {
    clients: {
      guid: "outletRopEmployee",
      mode: "outletRopEmployeeMode",
      missing: "missingOutletRop",
    },
    outlets: {
      guid: "outletRopEmployee",
      mode: "outletRopEmployeeMode",
      missing: "missingOutletRop",
    },
  };

  var ropMissingEntry = { id: logic.MISSING_ROP_ID, label: "РОП не указан" };
  var managerMissingEntry = { id: logic.MISSING_MANAGER_ID, label: "Менеджер не указан" };
  var regionalMissingEntry = { id: logic.MISSING_REGIONAL_ID, label: "Региональный не указан" };
  var hardwareMissingEntry = { id: logic.MISSING_HARDWARE_ID, label: "Менеджер по фурнитуре не указан" };
  var outletManagerMissingEntry = { id: logic.MISSING_MANAGER_ID + "_outlet", label: "Менеджер ТТ не указан" };
  var outletRegionalMissingEntry = { id: logic.MISSING_REGIONAL_ID + "_outlet", label: "Региональный ТТ не указан" };
  var outletHardwareMissingEntry = {
    id: logic.MISSING_HARDWARE_ID + "_outlet",
    label: "Менеджер по фурнитуре ТТ не указан",
  };
  var outletRopMissingEntry = { id: logic.MISSING_ROP_ID + "_outlet", label: "РОП ТТ не указан" };
  var currentUser = null;
  var rolePresentation = null;
  var teamContext = {
    director: null,
    rops: [],
    undefinedTeam: [],
    managers: [],
    ropSummary: null,
    ropName: "",
    managerName: "",
    limitationNote: "",
    loadError: false,
    ropTeams: [],
    onecGroups: [],
    onecAllGroups: [],
    onecLoadError: false,
    onecErrorMessage: "",
  };
  var compactTeams = null;
  var compactOnecTeams = null;
  var compactTeamsRenderToken = 0;
  var onecTeamsFetchGeneration = 0;
  var onecTeamsFetchAbortController = null;
  var onecTeamsOverviewRenderSignature = "";

  function onecTeamsOverviewRenderSignatureFromContext(renderState) {
    return JSON.stringify({
      ui: {
        teamExpand: (renderState && renderState.teamExpand) || [],
        teamQ: (renderState && renderState.teamQ) || "",
        onecTeam: (renderState && renderState.onecTeam) || "",
      },
      loadError: teamContext.onecLoadError,
      errorMessage: teamContext.onecErrorMessage || "",
      groups: (teamContext.onecGroups || []).map(function (group) {
        return {
          teamGuid: group.teamGuid,
          displayName: group.displayName,
          nameStatus: group.nameStatus,
          memberCount: group.memberCount,
          uniqueClientCount: group.uniqueClientCount,
          uniqueOutletCount: group.uniqueOutletCount,
          members: (group.members || []).map(function (member) {
            return {
              employeeGuid: member.employeeGuid,
              clientCount: member.clientCount,
              outletCount: member.outletCount,
              name: member.name,
            };
          }),
        };
      }),
    });
  }

  function getCompactTeams() {
    if (!compactTeams && window.ClientsTeamsCompact) {
      compactTeams = window.ClientsTeamsCompact.create({
        api: api,
        shell: shell,
        logic: logic,
        teamContext: teamContext,
        usesDirectorLayout: usesDirectorLayout,
        navigateDirectorBranchPortfolio: navigateDirectorBranchPortfolio,
        navigateDirectorResponsible: navigateDirectorResponsible,
        navigateRopBranchPortfolio: navigateRopBranchPortfolio,
        navigateResponsible: navigateResponsible,
        renderOrgBadge: renderOrgBadge,
        renderTeamSourceSwitch: function (state) {
          var onecModule = getOnecTeams();
          return onecModule ? onecModule.renderModeSwitch(state) : "";
        },
        bindTeamSourceSwitch: function (container, readState, callbacks) {
          var onecModule = getOnecTeams();
          if (onecModule) {
            onecModule.bindTeamSourceSwitch(container, readState, callbacks);
          }
        },
      });
    }
    return compactTeams;
  }

  var onecMemberPortfolioDelegationMounted = false;

  function mountOnecMemberPortfolioDelegation() {
    if (onecMemberPortfolioDelegationMounted || !teamsPanelEl) {
      return;
    }
    onecMemberPortfolioDelegationMounted = true;
    teamsPanelEl.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-onec-member-portfolio]");
      if (!btn) {
        return;
      }
      var state = getCurrentTeamsOverviewState();
      if (!usesOnecTeamSource(state)) {
        return;
      }
      event.stopPropagation();
      var onecModule = getOnecTeams();
      if (!onecModule) {
        return;
      }
      var employeeGuid = btn.getAttribute("data-employee-guid") || "";
      var portfolio = btn.getAttribute("data-onec-member-portfolio") || "clients";
      var section = btn.closest(".clients-onec-team");
      var teamKey = section ? section.getAttribute("data-onec-team") : "";
      var group = (teamContext.onecGroups || []).find(function (item) {
        return onecModule.teamExpandKey(item) === teamKey;
      });
      if (!group) {
        return;
      }
      var member = (group.members || []).find(function (item) {
        return item.employeeGuid === employeeGuid;
      });
      if (member) {
        navigateOnecTeamMember(state, member, group, portfolio);
        return;
      }
      if (group.leader && group.leader.employeeGuid === employeeGuid) {
        navigateOnecTeamMember(state, group.leader, group, portfolio);
      }
    });
  }

  function getOnecTeams() {
    mountOnecMemberPortfolioDelegation();
    if (!compactOnecTeams && window.ClientsOnecTeams) {
      compactOnecTeams = window.ClientsOnecTeams.create({
        api: api,
        shell: shell,
        logic: logic,
        navigateOnecTeamMember: navigateOnecTeamMember,
        navigateOnecGroupPortfolio: navigateOnecGroupPortfolio,
        readAppState: currentStateFromForm,
      });
    }
    return compactOnecTeams;
  }

  function usesOnecTeamSource(state) {
    return (usesDirectorLayout() || isRopDesignSession()) && state && state.teamSource === "onec";
  }

  function navigateOnecTeamMember(state, member, group, portfolio) {
    var resolvedPortfolio = portfolio || "clients";
    teamContext.managerName = member.name || member.shortId || member.employeeGuid;
    teamContext.onecTeamName = group.displayName || "";
    navigateState({
      view: "teams",
      teamSource: "onec",
      onecTeam: group.teamGuid || window.ClientsOnecTeams.UNDEFINED_KEY,
      teamExpand: [group.teamGuid || window.ClientsOnecTeams.UNDEFINED_KEY],
      manager: "",
      clientManager: "",
      outletManager: "",
      onecPortfolioEmployee: member.employeeGuid,
      regionalManager: "",
      hardwareManager: "",
      responsibleKind: "",
      portfolio: resolvedPortfolio,
      entity: resolvedPortfolio === "outlets" ? "outlets" : "clients",
      page: 1,
      ropEmployee: state.ropEmployee || "",
    });
  }

  function navigateOnecGroupPortfolio(state, group, portfolio) {
    teamContext.onecTeamName = group.displayName || "";
    navigateState({
      view: "teams",
      teamSource: "onec",
      onecTeam: group.teamGuid || window.ClientsOnecTeams.UNDEFINED_KEY,
      teamExpand: [group.teamGuid || window.ClientsOnecTeams.UNDEFINED_KEY],
      manager: "",
      clientManager: "",
      outletManager: "",
      onecPortfolioEmployee: "",
      regionalManager: "",
      hardwareManager: "",
      responsibleKind: "",
      portfolio: portfolio,
      entity: portfolio === "outlets" ? "outlets" : "clients",
      page: 1,
      ropEmployee: state.ropEmployee || "",
    });
  }

  function mergeTeamUiFromUrl(state) {
    var urlTeam = logic.readStateFromSearch(window.location.search);
    state.teamExpand = urlTeam.teamExpand || [];
    state.teamQ = urlTeam.teamQ || "";
    state.teamKind = urlTeam.teamKind || "";
    state.teamSource = urlTeam.teamSource || "rop";
    state.onecTeam = urlTeam.onecTeam || "";
    state.onecPortfolioEmployee = urlTeam.onecPortfolioEmployee || "";
    return state;
  }

  function getCurrentTeamsOverviewState() {
    return mergeTeamUiFromUrl(Object.assign({}, currentStateFromForm()));
  }

  function abortOnecTeamsFetch() {
    if (onecTeamsFetchAbortController) {
      onecTeamsFetchAbortController.abort();
      onecTeamsFetchAbortController = null;
    }
  }

  function nextOnecTeamsFetchSignal() {
    abortOnecTeamsFetch();
    onecTeamsFetchAbortController = new AbortController();
    return onecTeamsFetchAbortController.signal;
  }

  function bumpOnecTeamsFetchGeneration() {
    abortOnecTeamsFetch();
    onecTeamsFetchGeneration += 1;
    return onecTeamsFetchGeneration;
  }

  function isOnecTeamsFetchCurrent(generation, requestState) {
    if (generation !== onecTeamsFetchGeneration) {
      return false;
    }
    var current = getCurrentTeamsOverviewState();
    if (current.view !== "teams" || !usesOnecTeamSource(current)) {
      return false;
    }
    if (current.ropEmployee && !isRopDesignSession()) {
      return false;
    }
    if (isRopDesignSession() && current.ropEmployee && !usesOnecTeamSource(current)) {
      return false;
    }
    return buildOnecTeamsApiUrl(current) === buildOnecTeamsApiUrl(requestState);
  }

  function isCompactTeamOverviewState(state) {
    return (
      state.view === "teams" &&
      !logic.isBranchPortfolioList(state) &&
      !logic.hasResponsibleSelection(state) &&
      ((usesDirectorLayout() && !state.ropEmployee) ||
        (isRopDesignSession() && (state.ropEmployee || usesOnecTeamSource(state))))
    );
  }

  function compactTeamsNavigatePatch(nextState) {
    var merged = Object.assign({}, currentStateFromForm(), nextState);
    if (isCompactTeamOverviewState(merged)) {
      var previous = getCurrentTeamsOverviewState();
      var onecFetchNeeded =
        usesOnecTeamSource(merged) &&
        ((usesDirectorLayout() && !merged.ropEmployee) || isRopDesignSession()) &&
        (merged.teamSource !== previous.teamSource ||
          merged.teamQ !== previous.teamQ ||
          merged.onecTeam !== previous.onecTeam);
      if (onecFetchNeeded || (previous.teamSource === "onec" && merged.teamSource !== "onec")) {
        bumpOnecTeamsFetchGeneration();
        compactTeamsRenderToken += 1;
      }
      writeStateToUrl(merged, false);
      if (
        usesOnecTeamSource(merged) &&
        ((usesDirectorLayout() && !merged.ropEmployee) || isRopDesignSession())
      ) {
        var fetchGen = onecTeamsFetchGeneration;
        var requestState = Object.assign({}, merged);
        loadTeamsContext(requestState, fetchGen).then(function () {
          if (!isOnecTeamsFetchCurrent(fetchGen, requestState)) {
            return;
          }
          renderOnecTeamsOverview(getCurrentTeamsOverviewState());
        });
        return;
      }
      if (usesDirectorLayout() && !merged.ropEmployee) {
        var ropState = getCurrentTeamsOverviewState();
        loadTeamsContext(ropState).then(function () {
          if (usesOnecTeamSource(getCurrentTeamsOverviewState())) {
            return;
          }
          renderCompactTeamsOverview(getCurrentTeamsOverviewState());
        });
      } else {
        renderCompactRopTeamPanel(merged);
      }
      return;
    }
    navigateState(merged);
  }

  function readSearchInputFocus() {
    var searchInput = teamsPanelEl.querySelector("#clients-team-search-input");
    if (!searchInput || document.activeElement !== searchInput) {
      return null;
    }
    return {
      start: searchInput.selectionStart,
      end: searchInput.selectionEnd,
    };
  }

  function restoreSearchInputFocus(caret) {
    if (!caret) {
      return;
    }
    var searchInput = teamsPanelEl.querySelector("#clients-team-search-input");
    if (!searchInput) {
      return;
    }
    searchInput.focus();
    try {
      searchInput.setSelectionRange(caret.start, caret.end);
    } catch (err) {
      // Some input types do not support selection ranges.
    }
  }

  function renderOnecTeamsOverview(state) {
    var module = getOnecTeams();
    if (!module) {
      return Promise.resolve();
    }
    var renderState = state || getCurrentTeamsOverviewState();
    if (!usesOnecTeamSource(renderState)) {
      return Promise.resolve();
    }
    var searchCaret = readSearchInputFocus();
    var renderSignature = onecTeamsOverviewRenderSignatureFromContext(renderState);
    if (
      renderSignature === onecTeamsOverviewRenderSignature &&
      teamsPanelEl.querySelector(".clients-onec-team-list .clients-onec-team")
    ) {
      restoreSearchInputFocus(searchCaret);
      return Promise.resolve();
    }
    onecTeamsOverviewRenderSignature = renderSignature;
    if (
      !teamsPanelEl.querySelector(".clients-compact-team-toolbar") &&
      !(teamContext.onecGroups && teamContext.onecGroups.length)
    ) {
      teamsPanelEl.removeAttribute("data-onec-teams-ready");
      teamsPanelEl.innerHTML =
        '<div class="clients-compact-team__members clients-compact-team__members--loading">Загрузка групп из 1С…</div>';
    }
    var token = ++compactTeamsRenderToken;
    return module
      .prepareAndRenderOverview(
        renderState,
        {
          director: teamContext.director,
          groups: teamContext.onecGroups,
          allGroups: teamContext.onecAllGroups,
          loadError: teamContext.onecLoadError,
          errorMessage: teamContext.onecErrorMessage,
        },
        teamsPanelEl,
        {
          navigate: compactTeamsNavigatePatch,
          isStale: function () {
            return token !== compactTeamsRenderToken || !usesOnecTeamSource(getCurrentTeamsOverviewState());
          },
          refresh: function () {
            if (token !== compactTeamsRenderToken || !usesOnecTeamSource(getCurrentTeamsOverviewState())) {
              return;
            }
            var fetchGen = bumpOnecTeamsFetchGeneration();
            var requestState = getCurrentTeamsOverviewState();
            loadTeamsContext(requestState, fetchGen).then(function () {
              if (token !== compactTeamsRenderToken || !isOnecTeamsFetchCurrent(fetchGen, requestState)) {
                return;
              }
              renderOnecTeamsOverview(getCurrentTeamsOverviewState());
            });
          },
          restoreSearchFocus: function () {
            if (token !== compactTeamsRenderToken || !usesOnecTeamSource(getCurrentTeamsOverviewState())) {
              return;
            }
            restoreSearchInputFocus(searchCaret);
          },
        },
      )
      .catch(function () {
        if (token !== compactTeamsRenderToken || !usesOnecTeamSource(getCurrentTeamsOverviewState())) {
          return;
        }
        teamContext.onecLoadError = true;
        teamsPanelEl.innerHTML =
          '<div class="clients-compact-team__empty">Не удалось загрузить группы из 1С.</div>';
      });
  }

  function renderCompactTeamsOverview(state) {
    if (usesOnecTeamSource(state)) {
      return renderOnecTeamsOverview(state);
    }
    var module = getCompactTeams();
    if (!module) {
      return Promise.resolve();
    }
    var searchCaret = readSearchInputFocus();
    if (!teamsPanelEl.querySelector(".clients-compact-team-toolbar")) {
      teamsPanelEl.innerHTML =
        '<div class="clients-compact-team__members clients-compact-team__members--loading">Загрузка команд…</div>';
    }
    var token = ++compactTeamsRenderToken;
    return module
      .prepareAndRenderOverview(state, teamContext, teamsPanelEl, {
        navigate: compactTeamsNavigatePatch,
        isStale: function () {
          return token !== compactTeamsRenderToken;
        },
        syncExpand: function (expanded) {
          if (token !== compactTeamsRenderToken) {
            return;
          }
          writeStateToUrl(Object.assign({}, state, { teamExpand: expanded }), true);
        },
        restoreSearchFocus: function () {
          if (token !== compactTeamsRenderToken) {
            return;
          }
          restoreSearchInputFocus(searchCaret);
        },
        refresh: function () {
          if (token !== compactTeamsRenderToken) {
            return;
          }
          renderCompactTeamsOverview(state);
        },
      })
      .catch(function () {
        teamContext.loadError = true;
        teamsPanelEl.innerHTML =
          '<div class="clients-compact-team__empty">Не удалось загрузить команды.</div>';
      });
  }

  function renderCompactRopTeamPanel(state) {
    var module = getCompactTeams();
    if (!module) {
      return Promise.resolve();
    }
    var searchCaret = readSearchInputFocus();
    var token = ++compactTeamsRenderToken;
    return module.prepareAndRenderRopPanel(state, teamContext, teamsPanelEl, {
      navigate: compactTeamsNavigatePatch,
      isStale: function () {
        return token !== compactTeamsRenderToken;
      },
      restoreSearchFocus: function () {
        if (token !== compactTeamsRenderToken) {
          return;
        }
        restoreSearchInputFocus(searchCaret);
      },
      refresh: function () {
        if (token !== compactTeamsRenderToken) {
          return;
        }
        renderCompactRopTeamPanel(state);
      },
    });
  }

  var RESPONSIBLE_GROUP_LABELS = {
    manager: "Менеджеры продаж",
    regional: "Региональные менеджеры",
    hardware: "Менеджеры по фурнитуре",
  };

  var RESPONSIBLE_KIND_LABELS = {
    manager: "Менеджер продаж",
    regional: "Региональный менеджер",
    hardware: "Менеджер по фурнитуре",
  };
  var unassignedContext = { summary: null, categoryLabel: "", employeeName: "" };

  var ROLE_LABELS = {
    admin: "Администратор",
    director: "Директор",
    rop: "РОП",
    regional_manager: "Региональный менеджер",
    manager: "Менеджер",
    marketer: "Маркетолог",
    analyst: "Аналитик",
    category_manager: "Категорийный менеджер",
    assistant: "Ассистент",
    coordinator: "Координатор",
  };

  var MANAGER_PAGE_SUBTITLE =
    "Клиенты и торговые точки по вашим назначениям из 1С в зоне «Мои назначения».";

  var PORTFOLIO_DESIGN = {
    manager: {
      subtitle: MANAGER_PAGE_SUBTITLE,
      scopeValue: "Мои назначения",
      statClientLabel: "Мои клиенты",
      statOutletLabel: "Доступные ТТ",
      statNoOutletsLabel: "Клиенты без ТТ",
      showThirdStat: true,
    },
    regional_manager: {
      subtitle: "Закреплённые торговые точки и совместная работа с менеджерами.",
      scopeValue: "Только закреплённые клиенты и торговые точки",
      statClientLabel: "Доступные клиенты",
      statOutletLabel: "Мои ТТ",
      statNoOutletsLabel: "",
      showThirdStat: false,
    },
    rop: {
      subtitle: "Команда, собственные назначения и закреплённые клиенты и торговые точки.",
      scopeValue: "Моя команда и собственные назначения",
      statClientLabel: "Клиенты ветки",
      statOutletLabel: "ТТ ветки",
      statNoOutletsLabel: "Сотрудники команды",
      showThirdStat: true,
    },
    director: {
      subtitle: "Команды, клиенты и торговые точки, включая незаполненные назначения.",
      scopeValue: "Весь доступный состав отдела ОПТ",
      statClientLabel: "Доступные клиенты",
      statOutletLabel: "Доступные ТТ",
      statNoOutletsLabel: "Команды РОПов",
      showThirdStat: true,
    },
  };

  function isRopDesignSession() {
    return rolePresentation && rolePresentation.businessRole === "rop";
  }

  function usesDirectorLayout() {
    return Boolean(
      rolePresentation &&
        (rolePresentation.directorLayout === true ||
          rolePresentation.businessRole === "director" ||
          rolePresentation.businessRole === "admin"),
    );
  }

  function portfolioDesignConfig(presentation, state) {
    if (!presentation) {
      return null;
    }
    if (presentation.businessRole === "rop") {
      if (!state || (state.view || "all") !== "teams") {
        return null;
      }
      return PORTFOLIO_DESIGN.rop;
    }
    if (
      presentation.directorLayout === true ||
      presentation.businessRole === "director" ||
      presentation.businessRole === "admin"
    ) {
      return PORTFOLIO_DESIGN.director;
    }
    return PORTFOLIO_DESIGN[presentation.businessRole] || null;
  }

  function cardUserForDisplay(user) {
    var preview = shell.getPreviewState();
    if (
      rolePresentation &&
      rolePresentation.businessRole === "admin" &&
      (!preview || !preview.active)
    ) {
      var actor = shell.getActorUser();
      if (actor) {
        return actor;
      }
    }
    return user;
  }

  function readStateFromUrl() {
    return logic.readStateFromSearch(window.location.search);
  }

  function writeStateToUrl(state, replace) {
    var next = logic.buildListQueryString(state);
    var url = next ? "/clients?" + next : "/clients";
    if (replace) {
      window.history.replaceState(null, "", url);
    } else {
      window.history.pushState(null, "", url);
    }
  }

  function currentView() {
    return appEl.dataset.view || "all";
  }

  function currentEntity() {
    return appEl.dataset.entity || "clients";
  }

  function managerComboboxOptions() {
    return currentEntity() === "outlets" ? outletManagerOptions : managerOptions;
  }

  function resetComboboxStaleSuggestions(combobox) {
    if (!combobox) {
      return;
    }
    combobox.model.open = false;
    combobox.model.activeIndex = -1;
    if (combobox.renderList) {
      combobox.renderList();
    }
  }

  function applyAssignmentFilterWidgetToState(state, widget, keys, entity) {
    if (!widget) {
      return state;
    }
    return logic.applyAssignmentFilterSliceToState(state, keys, entity, widget.getState());
  }

  function applyAssignmentSelectionsToState(state) {
    if (state.view === "teams" || state.view === "review") {
      return state;
    }
    var entity = state.entity || "clients";
    applyAssignmentFilterWidgetToState(state, ropCombobox, ROP_ASSIGNMENT_KEYS, entity);
    applyAssignmentFilterWidgetToState(state, managerCombobox, MANAGER_ASSIGNMENT_KEYS, entity);
    applyAssignmentFilterWidgetToState(state, regionalCombobox, REGIONAL_ASSIGNMENT_KEYS, entity);
    applyAssignmentFilterWidgetToState(state, hardwareCombobox, HARDWARE_ASSIGNMENT_KEYS, entity);
    if (entity === "clients") {
      applyAssignmentFilterWidgetToState(state, outletManagerCombobox, OUTLET_MANAGER_ASSIGNMENT_KEYS, "clients");
      applyAssignmentFilterWidgetToState(state, outletRegionalCombobox, OUTLET_REGIONAL_ASSIGNMENT_KEYS, "clients");
      applyAssignmentFilterWidgetToState(state, outletHardwareCombobox, OUTLET_HARDWARE_ASSIGNMENT_KEYS, "clients");
      applyAssignmentFilterWidgetToState(state, outletRopCombobox, OUTLET_ROP_ASSIGNMENT_KEYS, "clients");
    }
    return state;
  }

  function syncAssignmentFilterFromState(widget, state, keys, entity) {
    if (!widget) {
      return;
    }
    widget.syncFromUrl(logic.assignmentFilterSliceFromState(state, keys, entity));
  }

  function currentStateFromForm() {
    var state = {
      view: currentView(),
      entity: currentEntity(),
      q: searchInput.value.trim(),
      manager: managerFilter.value,
      holding: holdingFilter.value,
      phone: phoneFilter.value || "all",
      rop: appEl.dataset.rop || "",
      ropEmployee: appEl.dataset.ropEmployee || "",
      unassignedCategory: unassignedFilter.value || "",
      reviewState: reviewStateFilter.value || "",
      reviewDecision: reviewDecisionFilter.value || "",
      hasOutlets: outletsFilter.value || "all",
      outletStatus: outletStatusFilter.value || "all",
      warehouse: warehouseFilter.value || "all",
      regionalManager: regionalFilter.value || "",
      hardwareManager: hardwareFilter ? hardwareFilter.value || appEl.dataset.hardwareManager || "" : appEl.dataset.hardwareManager || "",
      portfolio: appEl.dataset.portfolio || "",
      responsibleKind: appEl.dataset.responsibleKind || "",
      completenessReasons: readCompletenessReasonsFromFilter(),
      missingRop: false,
      missingManager: false,
      missingRegional: false,
      missingHardware: false,
      clientManager: "",
      outletManager: "",
      clientRegionalManager: "",
      outletRegionalManager: "",
      clientHardwareManager: "",
      outletHardwareManager: "",
      clientRopEmployee: "",
      outletRopEmployee: "",
      clientManagerMode: "",
      outletManagerMode: "",
      clientRegionalManagerMode: "",
      outletRegionalManagerMode: "",
      clientHardwareManagerMode: "",
      outletHardwareManagerMode: "",
      clientRopEmployeeMode: "",
      outletRopEmployeeMode: "",
      missingClientManager: false,
      missingOutletManager: false,
      missingClientRegional: false,
      missingOutletRegional: false,
      missingClientHardware: false,
      missingOutletHardware: false,
      missingClientRop: false,
      missingOutletRop: false,
      routeDirection: routeDirectionFilter ? routeDirectionFilter.value.trim() : "",
      storeAddressContains: storeAddressFilter ? storeAddressFilter.value.trim() : "",
      storePhoneContains: storePhoneFilter ? storePhoneFilter.value.trim() : "",
      accountantPhoneContains: accountantPhoneFilter ? accountantPhoneFilter.value.trim() : "",
      accountantEmailContains: accountantEmailFilter ? accountantEmailFilter.value.trim() : "",
      loadingTime: loadingTimeFilter ? loadingTimeFilter.value.trim() : "",
      loadingSchedule: loadingScheduleFilter ? loadingScheduleFilter.value || "all" : "all",
      discountProgram: discountProgramFilter ? discountProgramFilter.value.trim() : "",
      onecTop150: onecTop150Filter ? onecTop150Filter.value : "",
      onecCategory: onecCategoryFilter ? onecCategoryFilter.value : "",
      onecCounterpartyContains: onecCounterpartyFilter ? onecCounterpartyFilter.value.trim() : "",
      onecFullNameContains: onecFullNameFilter ? onecFullNameFilter.value.trim() : "",
      onecLegalEntityType: onecLegalTypeFilter ? onecLegalTypeFilter.value : "",
      onecOgrn: onecOgrnFilter ? onecOgrnFilter.value : "",
      onecPrimaryContractContains: onecPrimaryContractFilter ? onecPrimaryContractFilter.value.trim() : "",
      onecMainAgreementContains: onecMainAgreementFilter ? onecMainAgreementFilter.value.trim() : "",
      discountAmountMin: discountAmountMinFilter ? discountAmountMinFilter.value.trim() : "",
      discountAmountMax: discountAmountMaxFilter ? discountAmountMaxFilter.value.trim() : "",
      markupName: markupNameFilter ? markupNameFilter.value.trim() : "",
      markupPercentage: markupPercentageFilter ? markupPercentageFilter.value.trim() : "",
      bonusTandoorClub: bonusTandoorFilter ? bonusTandoorFilter.value.trim() : "",
      lprNameContains: lprNameFilter ? lprNameFilter.value.trim() : "",
      lprPostContains: lprPostFilter ? lprPostFilter.value.trim() : "",
      lprPhoneContains: lprPhoneFilter ? lprPhoneFilter.value.trim() : "",
      lprEmailContains: lprEmailFilter ? lprEmailFilter.value.trim() : "",
      lprBonusContains: lprBonusFilter ? lprBonusFilter.value.trim() : "",
      lprConditionsBonusContains: lprConditionsFilter ? lprConditionsFilter.value.trim() : "",
      lprDateOfBirth: lprDobFilter ? lprDobFilter.value.trim() : "",
      lprDateOfBirthFrom: lprDobFromFilter ? lprDobFromFilter.value.trim() : "",
      lprDateOfBirthTo: lprDobToFilter ? lprDobToFilter.value.trim() : "",
      filled: filledFieldFilter ? filledFieldFilter.value || "" : "",
      empty: emptyFieldFilter ? emptyFieldFilter.value || "" : "",
      tandoorClub: tandoorFilter.value.trim(),
      sortBy: appEl.dataset.sortBy || "",
      sortDir: appEl.dataset.sortDir || "",
      cols: appEl.dataset.cols || "",
      page: Number(appEl.dataset.page || "1") || 1,
    };
    return mergeTeamUiFromUrl(applyAssignmentSelectionsToState(state));
  }

  function columnsStorageKey(entity) {
    return logic.buildColumnsStorageKey(currentUser && currentUser.id, entity || currentEntity());
  }

  function resolveColumnsForState(state) {
    return logic.resolveVisibleColumns({
      entity: state.entity || "clients",
      view: state.view || "all",
      cols: state.cols || "",
      storageKey: columnsStorageKey(state.entity || "clients"),
    });
  }

  function columnsParamFromIds(columnIds) {
    return columnIds.join(",");
  }

  function cancelScheduledLoad() {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  function readCompletenessReasonsFromFilter() {
    if (!completenessReasonFilter) {
      return [];
    }
    return Array.from(completenessReasonFilter.selectedOptions)
      .map(function (opt) {
        return opt.value;
      })
      .filter(function (value) {
        return value.length > 0;
      });
  }

  function applyCompletenessReasonsToFilter(reasons) {
    if (!completenessReasonFilter) {
      return;
    }
    var selected = new Set(reasons || []);
    Array.from(completenessReasonFilter.options).forEach(function (opt) {
      opt.selected = selected.has(opt.value);
    });
  }

  function invalidateInFlightRequests() {
    if (listFetchAbortController) {
      listFetchAbortController.abort();
      listFetchAbortController = null;
    }
    activeRequestId += 1;
    bumpOnecTeamsFetchGeneration();
  }

  function nextListFetchSignal() {
    listFetchAbortController = new AbortController();
    return listFetchAbortController.signal;
  }

  function applyStateToForm(state) {
    var previousEntity = appEl.dataset.entity || "clients";
    var nextEntity = state.entity || "clients";
    var entityChanged = previousEntity !== nextEntity;
    appEl.dataset.view = state.view || "all";
    appEl.dataset.entity = nextEntity;
    appEl.dataset.rop = state.rop || "";
    appEl.dataset.ropEmployee = state.ropEmployee || "";
    appEl.dataset.portfolio = state.portfolio || "";
    appEl.dataset.responsibleKind = state.responsibleKind || "";
    appEl.dataset.hardwareManager = state.hardwareManager || "";
    appEl.dataset.page = String(state.page);
    appEl.dataset.sortBy = state.sortBy || "";
    appEl.dataset.sortDir = state.sortDir || "";
    appEl.dataset.cols = state.cols || "";
    visibleColumnIds = resolveColumnsForState(state);
    searchInput.value = state.q || "";
    var isOutletsEntity = (state.entity || "clients") === "outlets";
    managerFilter.value = isOutletsEntity
      ? state.missingOutletManager
        ? ""
        : state.outletManager || state.manager || ""
      : state.missingClientManager
        ? ""
        : state.clientManager || state.manager || "";
    holdingFilter.value = state.holding;
    phoneFilter.value = state.phone || "all";
    outletsFilter.value = state.hasOutlets || "all";
    outletStatusFilter.value = state.outletStatus || "all";
    warehouseFilter.value = state.warehouse || "all";
    regionalFilter.value = isOutletsEntity
      ? state.missingOutletRegional
        ? ""
        : state.outletRegionalManager || state.regionalManager || ""
      : state.missingClientRegional
        ? ""
        : state.clientRegionalManager || state.regionalManager || "";
    if (hardwareFilter) {
      hardwareFilter.value = isOutletsEntity
        ? state.missingOutletHardware
          ? ""
          : state.outletHardwareManager || state.hardwareManager || ""
        : state.missingClientHardware
          ? ""
          : state.clientHardwareManager || state.hardwareManager || "";
    }
    if (outletManagerFilter) {
      outletManagerFilter.value = state.missingOutletManager ? "" : state.outletManager || "";
    }
    if (outletRegionalFilter) {
      outletRegionalFilter.value = state.missingOutletRegional ? "" : state.outletRegionalManager || "";
    }
    if (outletHardwareFilter) {
      outletHardwareFilter.value = state.missingOutletHardware ? "" : state.outletHardwareManager || "";
    }
    if (outletRopFilter) {
      outletRopFilter.value = state.missingOutletRop ? "" : state.outletRopEmployee || "";
    }
    if (routeDirectionFilter) routeDirectionFilter.value = state.routeDirection || "";
    if (storeAddressFilter) storeAddressFilter.value = state.storeAddressContains || "";
    if (storePhoneFilter) storePhoneFilter.value = state.storePhoneContains || "";
    if (accountantPhoneFilter) accountantPhoneFilter.value = state.accountantPhoneContains || "";
    if (accountantEmailFilter) accountantEmailFilter.value = state.accountantEmailContains || "";
    if (loadingTimeFilter) loadingTimeFilter.value = state.loadingTime || "";
    if (loadingScheduleFilter) loadingScheduleFilter.value = state.loadingSchedule || "all";
    if (filledFieldFilter) filledFieldFilter.value = state.filled || "";
    if (emptyFieldFilter) emptyFieldFilter.value = state.empty || "";
    if (discountProgramFilter) discountProgramFilter.value = state.discountProgram || "";
    if (onecTop150Filter) onecTop150Filter.value = state.onecTop150 || "";
    if (onecCategoryFilter) onecCategoryFilter.value = state.onecCategory || "";
    if (onecCounterpartyFilter) onecCounterpartyFilter.value = state.onecCounterpartyContains || "";
    if (onecFullNameFilter) onecFullNameFilter.value = state.onecFullNameContains || "";
    if (onecLegalTypeFilter) onecLegalTypeFilter.value = state.onecLegalEntityType || "";
    if (onecOgrnFilter) onecOgrnFilter.value = state.onecOgrn || "";
    if (onecPrimaryContractFilter) {
      onecPrimaryContractFilter.value = state.onecPrimaryContractContains || "";
    }
    if (onecMainAgreementFilter) onecMainAgreementFilter.value = state.onecMainAgreementContains || "";
    if (discountAmountMinFilter) discountAmountMinFilter.value = state.discountAmountMin || "";
    if (discountAmountMaxFilter) discountAmountMaxFilter.value = state.discountAmountMax || "";
    if (markupNameFilter) markupNameFilter.value = state.markupName || "";
    if (markupPercentageFilter) markupPercentageFilter.value = state.markupPercentage || "";
    if (bonusTandoorFilter) bonusTandoorFilter.value = state.bonusTandoorClub || "";
    if (lprNameFilter) lprNameFilter.value = state.lprNameContains || "";
    if (lprPostFilter) lprPostFilter.value = state.lprPostContains || "";
    if (lprPhoneFilter) lprPhoneFilter.value = state.lprPhoneContains || "";
    if (lprEmailFilter) lprEmailFilter.value = state.lprEmailContains || "";
    if (lprBonusFilter) lprBonusFilter.value = state.lprBonusContains || "";
    if (lprConditionsFilter) lprConditionsFilter.value = state.lprConditionsBonusContains || "";
    if (lprDobFilter) lprDobFilter.value = state.lprDateOfBirth || "";
    if (lprDobFromFilter) lprDobFromFilter.value = state.lprDateOfBirthFrom || "";
    if (lprDobToFilter) lprDobToFilter.value = state.lprDateOfBirthTo || "";
    tandoorFilter.value = state.tandoorClub || "";
    reviewStateFilter.value = state.reviewState || "";
    reviewDecisionFilter.value = state.reviewDecision || "";
    unassignedFilter.value = state.unassignedCategory || "";
    applyCompletenessReasonsToFilter(state.completenessReasons || []);
    if (state.view !== "teams" && state.view !== "review") {
      syncAssignmentFilterFromState(ropCombobox, state, ROP_ASSIGNMENT_KEYS, nextEntity);
      syncAssignmentFilterFromState(managerCombobox, state, MANAGER_ASSIGNMENT_KEYS, nextEntity);
      syncAssignmentFilterFromState(regionalCombobox, state, REGIONAL_ASSIGNMENT_KEYS, nextEntity);
      syncAssignmentFilterFromState(hardwareCombobox, state, HARDWARE_ASSIGNMENT_KEYS, nextEntity);
      if (!isOutletsEntity) {
        syncAssignmentFilterFromState(outletManagerCombobox, state, OUTLET_MANAGER_ASSIGNMENT_KEYS, "clients");
        syncAssignmentFilterFromState(outletRegionalCombobox, state, OUTLET_REGIONAL_ASSIGNMENT_KEYS, "clients");
        syncAssignmentFilterFromState(outletHardwareCombobox, state, OUTLET_HARDWARE_ASSIGNMENT_KEYS, "clients");
        syncAssignmentFilterFromState(outletRopCombobox, state, OUTLET_ROP_ASSIGNMENT_KEYS, "clients");
      }
    }
    if (entityChanged) {
      resetComboboxStaleSuggestions(managerCombobox);
      resetComboboxStaleSuggestions(outletManagerCombobox);
      resetComboboxStaleSuggestions(regionalCombobox);
      resetComboboxStaleSuggestions(hardwareCombobox);
      resetComboboxStaleSuggestions(ropCombobox);
    }
    if (holdingCombobox) {
      holdingCombobox.syncFromUrl(state.holding);
    }
    updateViewSwitcherActive(state.view || "all");
    updateEntitySwitcherActive(state.entity || "clients");
    updateViewChrome(state);
    renderTableHead(state);
  }

  function initialsFromName(name) {
    var parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(function (part) {
        return part.length > 0;
      });
    if (parts.length >= 2) {
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    }
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return "—";
  }

  function formatStatValue(total) {
    if (typeof total !== "number" || !Number.isFinite(total)) {
      return "—";
    }
    return String(total);
  }

  function renderEmployeeCard(user) {
    if (!user || !employeeNameEl) {
      return;
    }
    var displayName = user.fullName || user.email || "Сотрудник";
    employeeNameEl.textContent = displayName;
    if (employeeRoleEl) {
      employeeRoleEl.textContent = ROLE_LABELS[user.role] || user.role || "";
    }
    if (employeeAvatarEl) {
      employeeAvatarEl.textContent = initialsFromName(displayName);
    }
  }

  function applyPortfolioDesignChrome(presentation, user, state) {
    var viewState = state || currentStateFromForm();
    var config = portfolioDesignConfig(presentation, viewState);
    var isManager = presentation && presentation.businessRole === "manager";
    var isRegional = presentation && presentation.businessRole === "regional_manager";
    var isRop = isRopDesignSession() && (viewState.view || "all") === "teams";
    var isDirector = usesDirectorLayout();
    document.body.classList.toggle("clients-role-manager", Boolean(isManager));
    document.body.classList.toggle("clients-role-regional", Boolean(isRegional));
    document.body.classList.toggle("clients-role-rop", Boolean(isRop));
    document.body.classList.toggle("clients-role-director", Boolean(isDirector));
    if (pageSubtitleEl) {
      if (config && config.subtitle) {
        pageSubtitleEl.textContent = config.subtitle;
        pageSubtitleEl.classList.remove("clients-hidden");
      } else {
        pageSubtitleEl.textContent = "";
        pageSubtitleEl.classList.add("clients-hidden");
      }
    }
    if (managerChromeEl) {
      managerChromeEl.classList.toggle("clients-hidden", !config);
    }
    if (workspaceNavEl) {
      workspaceNavEl.classList.toggle("clients-hidden", isRopDesignSession() || isDirector);
    }
    if (workspaceNavTabEl && !isRopDesignSession() && !isDirector) {
      workspaceNavTabEl.textContent = "Моя база";
    }
    if (incompleteStatsStripEl) {
      incompleteStatsStripEl.classList.toggle("clients-hidden", !isDirector);
    }
    if (config) {
      renderEmployeeCard(cardUserForDisplay(user));
      if (employeeScopeValueEl) {
        employeeScopeValueEl.textContent = config.scopeValue;
      }
      if (statClientsLabelEl) {
        statClientsLabelEl.textContent = config.statClientLabel;
      }
      if (statOutletsLabelEl) {
        statOutletsLabelEl.textContent = config.statOutletLabel;
      }
      if (statNoOutletsLabelEl && config.statNoOutletsLabel) {
        statNoOutletsLabelEl.textContent = config.statNoOutletsLabel;
      }
      if (statsStripEl) {
        statsStripEl.classList.toggle("clients-stats-strip--two-cols", !config.showThirdStat);
      }
      if (statNoOutletsWrapEl) {
        statNoOutletsWrapEl.classList.toggle("clients-hidden", !config.showThirdStat);
      }
    }
  }

  function renderRopStatsFromSummary(summary) {
    if (!summary) {
      if (statClientsEl) {
        statClientsEl.textContent = "—";
      }
      if (statOutletsEl) {
        statOutletsEl.textContent = "—";
      }
      if (statNoOutletsEl) {
        statNoOutletsEl.textContent = "—";
      }
      return;
    }
    if (statClientsEl) {
      statClientsEl.textContent = formatStatValue(summary.uniqueClientCount);
    }
    if (statOutletsEl) {
      statOutletsEl.textContent = formatStatValue(summary.uniqueOutletCount);
    }
    if (statNoOutletsEl) {
      statNoOutletsEl.textContent = formatStatValue(summary.teamMemberCount);
    }
  }

  function loadRopTeamStats(state) {
    if (!isRopDesignSession() || (state.view || "all") !== "teams") {
      return Promise.resolve();
    }
    if (teamContext.ropSummary && state.ropEmployee) {
      renderRopStatsFromSummary(teamContext.ropSummary);
      return Promise.resolve();
    }
    return api.apiRequest("/api/clients/org-structure").then(function (result) {
      if (result.response.status !== 200 || !result.data) {
        renderRopStatsFromSummary(null);
        return;
      }
      var rops = result.data.rops || [];
      var match = state.ropEmployee
        ? rops.find(function (item) {
            return item.employeeGuid === state.ropEmployee;
          })
        : rops[0];
      teamContext.ropSummary = match || null;
      renderRopStatsFromSummary(teamContext.ropSummary);
    });
  }

  function loadDirectorStats() {
    if (!usesDirectorLayout()) {
      return Promise.resolve();
    }
    var baseParams = { view: "all", page: "1", pageSize: "1" };
    function fetchTotal(extra) {
      var params = new URLSearchParams(baseParams);
      Object.keys(extra).forEach(function (key) {
        params.set(key, extra[key]);
      });
      return api
        .apiRequest("/api/clients?" + params.toString())
        .then(function (result) {
          if (result.response.status !== 200 || !result.data) {
            return null;
          }
          if (typeof result.data.total !== "number") {
            return null;
          }
          return result.data.total;
        })
        .catch(function () {
          return null;
        });
    }
    return Promise.all([
      fetchTotal({ entity: "clients" }),
      fetchTotal({ entity: "outlets" }),
      api.apiRequest("/api/clients/org-structure"),
      api.apiRequest("/api/clients/completeness-queue?page=1&pageSize=1"),
    ]).then(function (results) {
      if (statClientsEl) {
        statClientsEl.textContent = formatStatValue(results[0]);
      }
      if (statOutletsEl) {
        statOutletsEl.textContent = formatStatValue(results[1]);
      }
      var ropCount = null;
      if (results[2].response.status === 200 && results[2].data) {
        ropCount = (results[2].data.rops || []).length;
      }
      if (statNoOutletsEl) {
        statNoOutletsEl.textContent = formatStatValue(ropCount);
      }
      var incompleteClients = null;
      var incompleteOutlets = null;
      if (results[3].response.status === 200 && results[3].data && results[3].data.summary) {
        incompleteClients = results[3].data.summary.clients;
        incompleteOutlets = results[3].data.summary.outlets;
      }
      if (statIncompleteClientsEl) {
        statIncompleteClientsEl.textContent = formatStatValue(incompleteClients);
      }
      if (statIncompleteOutletsEl) {
        statIncompleteOutletsEl.textContent = formatStatValue(incompleteOutlets);
      }
      if (statIncompleteCompactClientsEl) {
        statIncompleteCompactClientsEl.textContent = formatStatValue(incompleteClients);
      }
      if (statIncompleteCompactOutletsEl) {
        statIncompleteCompactOutletsEl.textContent = formatStatValue(incompleteOutlets);
      }
    });
  }

  function mountDirectorStatLinks() {
    if (!usesDirectorLayout()) {
      return;
    }
    [statClientsEl, statOutletsEl, statNoOutletsEl, statIncompleteClientsEl, statIncompleteOutletsEl].forEach(
      function (el) {
        el?.classList.add("clients-stat__value--link");
      },
    );
    if (statClientsEl && !statClientsEl.dataset.directorStatBound) {
      statClientsEl.dataset.directorStatBound = "1";
      statClientsEl.addEventListener("click", function () {
        navigateState({ view: "all", entity: "clients", page: 1, portfolio: "", ropEmployee: "" });
      });
    }
    if (statOutletsEl && !statOutletsEl.dataset.directorStatBound) {
      statOutletsEl.dataset.directorStatBound = "1";
      statOutletsEl.addEventListener("click", function () {
        navigateState({ view: "all", entity: "outlets", page: 1, portfolio: "", ropEmployee: "" });
      });
    }
    if (statNoOutletsEl && !statNoOutletsEl.dataset.directorStatBound) {
      statNoOutletsEl.dataset.directorStatBound = "1";
      statNoOutletsEl.addEventListener("click", function () {
        navigateState({
          view: "teams",
          entity: "clients",
          page: 1,
          ropEmployee: "",
          portfolio: "",
          manager: "",
          regionalManager: "",
          hardwareManager: "",
          responsibleKind: "",
        });
      });
    }
    if (statIncompleteClientsEl && !statIncompleteClientsEl.dataset.directorStatBound) {
      statIncompleteClientsEl.dataset.directorStatBound = "1";
      statIncompleteClientsEl.addEventListener("click", function () {
        navigateState({
          view: "completeness",
          entity: "clients",
          page: 1,
          completenessReasons: [],
        });
      });
    }
    if (statIncompleteOutletsEl && !statIncompleteOutletsEl.dataset.directorStatBound) {
      statIncompleteOutletsEl.dataset.directorStatBound = "1";
      statIncompleteOutletsEl.addEventListener("click", function () {
        navigateState({
          view: "completeness",
          entity: "outlets",
          page: 1,
          completenessReasons: [],
        });
      });
    }
    if (statIncompleteCompactLinkEl && !statIncompleteCompactLinkEl.dataset.directorStatBound) {
      statIncompleteCompactLinkEl.dataset.directorStatBound = "1";
      statIncompleteCompactLinkEl.addEventListener("click", function () {
        navigateState({
          view: "completeness",
          entity: "clients",
          page: 1,
          completenessReasons: [],
        });
      });
    }
  }

  function loadPortfolioStats(state) {
    var config = portfolioDesignConfig(rolePresentation, state || currentStateFromForm());
    if (!config) {
      return Promise.resolve();
    }
    if (usesDirectorLayout()) {
      return loadDirectorStats();
    }
    if (isRopDesignSession()) {
      return loadRopTeamStats(state || currentStateFromForm());
    }
    var baseParams = { view: "all", page: "1", pageSize: "1" };
    function fetchTotal(extra) {
      var params = new URLSearchParams(baseParams);
      Object.keys(extra).forEach(function (key) {
        params.set(key, extra[key]);
      });
      return api
        .apiRequest("/api/clients?" + params.toString())
        .then(function (result) {
          if (result.response.status !== 200 || !result.data) {
            return null;
          }
          if (typeof result.data.total !== "number") {
            return null;
          }
          return result.data.total;
        })
        .catch(function () {
          return null;
        });
    }
    var requests = [fetchTotal({ entity: "clients" }), fetchTotal({ entity: "outlets" })];
    if (config.showThirdStat) {
      requests.push(fetchTotal({ entity: "clients", hasOutlets: "no" }));
    }
    return Promise.all(requests).then(function (totals) {
      if (statClientsEl) {
        statClientsEl.textContent = formatStatValue(totals[0]);
      }
      if (statOutletsEl) {
        statOutletsEl.textContent = formatStatValue(totals[1]);
      }
      if (config.showThirdStat && statNoOutletsEl) {
        statNoOutletsEl.textContent = formatStatValue(totals[2]);
      }
    });
  }

  function applyRoleChrome(presentation) {
    rolePresentation = presentation;
    applyOnecUpdatePanelVisibility();
    if (!presentation) {
      return;
    }
    if (pageTitleEl) {
      pageTitleEl.textContent = presentation.pageTitle || "Клиенты";
    }
    document.title = (presentation.pageTitle || "Клиенты") + " — tandoor-rf";
    viewSwitcherEl.classList.toggle("clients-hidden", !presentation.showViewSwitcher);
    entitySwitcherEl.classList.toggle(
      "clients-hidden",
      !(presentation.allowedEntities && presentation.allowedEntities.length > 1),
    );
    viewReviewTab.classList.toggle(
      "clients-hidden",
      !(presentation.allowedViews && presentation.allowedViews.indexOf("review") !== -1),
    );
    if (viewCompletenessTab) {
      viewCompletenessTab.classList.toggle(
        "clients-hidden",
        !(presentation.allowedViews && presentation.allowedViews.indexOf("completeness") !== -1),
      );
    }
    updateDesignViewSwitcherLabels();
    applyPortfolioDesignChrome(presentation, currentUser, currentStateFromForm());
  }

  function assignmentFilterIsActive(state, keys, entity) {
    var slice = logic.assignmentFilterSliceFromState(state, keys, entity);
    return Boolean(slice.mode || (slice.guids && slice.guids.length > 0));
  }

  function countActiveFilters(state) {
    var count = 0;
    var entity = state.entity || "clients";
    if (state.q && state.q.trim()) {
      count += 1;
    }
    if (assignmentFilterIsActive(state, MANAGER_ASSIGNMENT_KEYS, entity)) {
      count += 1;
    }
    if (state.holding) {
      count += 1;
    }
    if (state.phone && state.phone !== "all") {
      count += 1;
    }
    if (state.hasOutlets && state.hasOutlets !== "all") {
      count += 1;
    }
    if (state.outletStatus && state.outletStatus !== "all") {
      count += 1;
    }
    if (state.warehouse && state.warehouse !== "all") {
      count += 1;
    }
    if (assignmentFilterIsActive(state, REGIONAL_ASSIGNMENT_KEYS, entity)) {
      count += 1;
    }
    if (assignmentFilterIsActive(state, HARDWARE_ASSIGNMENT_KEYS, entity)) {
      count += 1;
    }
    if (state.tandoorClub && state.tandoorClub.trim()) {
      count += 1;
    }
    if (assignmentFilterIsActive(state, ROP_ASSIGNMENT_KEYS, entity)) {
      count += 1;
    }
    if (entity === "clients") {
      if (assignmentFilterIsActive(state, OUTLET_MANAGER_ASSIGNMENT_KEYS, "clients")) {
        count += 1;
      }
      if (assignmentFilterIsActive(state, OUTLET_REGIONAL_ASSIGNMENT_KEYS, "clients")) {
        count += 1;
      }
      if (assignmentFilterIsActive(state, OUTLET_HARDWARE_ASSIGNMENT_KEYS, "clients")) {
        count += 1;
      }
      if (assignmentFilterIsActive(state, OUTLET_ROP_ASSIGNMENT_KEYS, "clients")) {
        count += 1;
      }
    }
    return count;
  }

  function updateResponsibleFilterLabels(isOutlets) {
    if (ropFilterLabelEl) {
      ropFilterLabelEl.textContent = isOutlets ? "РОП ТТ" : "РОП клиента";
    }
    if (managerFilterLabelEl) {
      managerFilterLabelEl.textContent = isOutlets ? "Менеджер ТТ" : "Менеджер клиента";
    }
    if (regionalFilterLabelEl) {
      regionalFilterLabelEl.textContent = isOutlets ? "Региональный ТТ" : "Региональный клиента";
    }
    if (hardwareFilterLabelEl) {
      hardwareFilterLabelEl.textContent = isOutlets ? "По фурнитуре ТТ" : "По фурнитуре клиента";
    }
    ropMissingEntry.label = isOutlets ? "РОП ТТ не указан" : "РОП клиента не указан";
    managerMissingEntry.label = isOutlets ? "Менеджер ТТ не указан" : "Менеджер клиента не указан";
    regionalMissingEntry.label = isOutlets ? "Региональный ТТ не указан" : "Региональный клиента не указан";
    hardwareMissingEntry.label = isOutlets
      ? "Менеджер по фурнитуре ТТ не указан"
      : "Менеджер по фурнитуре клиента не указан";
  }

  function updateActiveFiltersBadge(state) {
    if (!filtersActiveCountEl) {
      return;
    }
    var activeCount = countActiveFilters(state);
    if (activeCount > 0) {
      filtersActiveCountEl.textContent = String(activeCount);
      filtersActiveCountEl.classList.remove("clients-hidden");
    } else {
      filtersActiveCountEl.textContent = "";
      filtersActiveCountEl.classList.add("clients-hidden");
    }
  }

  function updateResultsTitle(state) {
    if (!resultsTitleEl) {
      return;
    }
    var role = rolePresentation && rolePresentation.businessRole;
    var isPortfolioRole = role === "manager" || role === "regional_manager";
    var isRopList =
      isRopDesignSession() &&
      state.view === "teams" &&
      (logic.isBranchPortfolioList(state) || logic.hasResponsibleSelection(state));
    var isDirectorList =
      usesDirectorLayout() &&
      state.view === "teams" &&
      (logic.isBranchPortfolioList(state) || logic.hasResponsibleSelection(state));
    if ((!isPortfolioRole && !isRopList && !isDirectorList) || (isPortfolioRole && state.view !== "all")) {
      if (!isRopList && !isDirectorList) {
        resultsTitleEl.classList.add("clients-hidden");
        return;
      }
    }
    var entity = state.entity || "clients";
    if (isRopList || isDirectorList) {
      if (logic.hasResponsibleSelection(state)) {
        resultsTitleEl.textContent =
          entity === "outlets" ? "Торговые точки сотрудника" : "Клиенты сотрудника";
      } else if (state.portfolio === "outlets" || entity === "outlets") {
        resultsTitleEl.textContent = "ТТ ветки";
      } else {
        resultsTitleEl.textContent = "Клиенты ветки";
      }
      resultsTitleEl.classList.remove("clients-hidden");
      return;
    }
    if (usesDirectorLayout() && state.view === "all") {
      resultsTitleEl.textContent =
        entity === "outlets" ? "Доступные торговые точки" : "Все клиенты";
      resultsTitleEl.classList.remove("clients-hidden");
      return;
    }
    if (usesDirectorLayout() && state.view === "completeness") {
      resultsTitleEl.textContent = "Незаполненные назначения";
      resultsTitleEl.classList.remove("clients-hidden");
      return;
    }
    if (entity === "outlets") {
      resultsTitleEl.textContent = "Доступные торговые точки";
    } else if (role === "regional_manager") {
      resultsTitleEl.textContent = "Доступные клиенты";
    } else {
      resultsTitleEl.textContent = "Мои клиенты";
    }
    resultsTitleEl.classList.remove("clients-hidden");
  }

  function loadPresentation() {
    return api.apiRequest("/api/clients/presentation").then(function (result) {
      if (result.response.status === 403) {
        return { ok: false, forbidden: true };
      }
      if (result.response.status !== 200 || !result.data || !result.data.presentation) {
        return {
          ok: false,
          message: api.extractErrorMessage(result.data, "Не удалось определить роль."),
        };
      }
      applyRoleChrome(result.data.presentation);
      return { ok: true, presentation: result.data.presentation };
    });
  }

  function updateEntitySwitcherActive(entity) {
    if (!entitySwitcherEl) {
      return;
    }
    entitySwitcherEl.querySelectorAll("[data-entity]").forEach(function (btn) {
      btn.classList.toggle("clients-view-switcher__btn--active", btn.getAttribute("data-entity") === entity);
    });
  }

  function columnDefById(entity, columnId) {
    return logic.columnDefinitions(entity).find(function (col) {
      return col.id === columnId;
    });
  }

  function renderNoDataCell() {
    return '<span class="clients-no-data">' + shell.escapeHtml(logic.NO_DATA_LABEL) + "</span>";
  }

  function renderTableHead(state) {
    if (!tableHeadRow) {
      return;
    }
    var entity = state.entity || "clients";
    var sortBy = state.sortBy || (entity === "outlets" ? "clientName" : "name");
    var sortDir = state.sortDir || "asc";
    tableHeadRow.innerHTML = visibleColumnIds
      .map(function (columnId) {
        var def = columnDefById(entity, columnId);
        if (!def) {
          return "";
        }
        var sortable = def.sortable && def.hasSource;
        var classes = sortable ? " clients-table__sortable" : "";
        var indicator = sortable ? logic.sortIndicator(sortBy, sortDir, columnId) : "";
        return (
          '<th scope="col" data-column="' +
          shell.escapeHtml(columnId) +
          '"' +
          (sortable ? ' data-sortable="true"' : "") +
          ' class="' +
          classes.trim() +
          '">' +
          shell.escapeHtml(def.label) +
          indicator +
          "</th>"
        );
      })
      .join("");
    tableHeadRow.querySelectorAll("[data-sortable]").forEach(function (th) {
      th.addEventListener("click", function () {
        var columnId = th.getAttribute("data-column") || "";
        var def = columnDefById(entity, columnId);
        if (!def || !def.sortable) {
          return;
        }
        var next = logic.nextSortState(sortBy, sortDir, columnId);
        navigateState(
          Object.assign({}, currentStateFromForm(), {
            sortBy: next.sortBy,
            sortDir: next.sortDir,
            page: 1,
          }),
        );
      });
    });
  }

  function renderAssignmentRefCell(ref) {
    if (!ref || !ref.hasSource) {
      return renderNoDataCell();
    }
    if (ref.assignmentLabel) {
      return shell.escapeHtml(ref.assignmentLabel);
    }
    if (!ref.id && !ref.name) {
      return '<span class="clients-phone-muted">—</span>';
    }
    var label = ref.name || ref.id || "—";
    if (ref.shortId && ref.name) {
      label += " · " + ref.shortId;
    }
    return shell.escapeHtml(label);
  }

  function renderClientColumnCell(columnId, item) {
    var def = columnDefById("clients", columnId);
    if (def && !def.hasSource) {
      return renderNoDataCell();
    }
    if (columnId === "name") {
      return (
        '<a class="clients-link" href="' +
        clientHref(item.guid) +
        '">' +
        shell.escapeHtml(item.name) +
        "</a>"
      );
    }
    if (columnId === "holding") {
      return renderHoldingCell(item);
    }
    if (columnId === "manager") {
      return shell.escapeHtml(item.manager.name) + " · " + shell.escapeHtml(item.manager.shortId);
    }
    if (columnId === "regional") {
      return renderAssignmentRefCell(item.regionalManager);
    }
    if (columnId === "hardware") {
      return renderAssignmentRefCell(item.hardwareManager);
    }
    if (columnId === "rop") {
      return renderAssignmentRefCell(item.headOfSales);
    }
    if (columnId === "team") {
      return renderTeamCell(item);
    }
    if (columnId === "review") {
      return renderReviewCell(item);
    }
    if (columnId === "address") {
      return shell.escapeHtml(item.address || "—");
    }
    if (columnId === "phone") {
      return renderPhonePreview(item.phonePreview);
    }
    if (columnId === "outletsCount") {
      if (item.outletsCount === undefined || item.outletsCount === null) {
        return renderNoDataCell();
      }
      return shell.escapeHtml(String(item.outletsCount));
    }
    if (columnId === "assignmentState") {
      if (!item.teamContext || !item.teamContext.unassignedReason) {
        return '<span class="clients-phone-muted">—</span>';
      }
      return (
        '<span class="clients-tag clients-tag--warn">' +
        shell.escapeHtml(item.teamContext.unassignedReason) +
        "</span>"
      );
    }
    if (columnId === "discountProgram") {
      if (!item.discountProgram || !item.discountProgram.hasSource) {
        return renderNoDataCell();
      }
      return shell.escapeHtml(item.discountProgram.label || "—");
    }
    if (columnId === "discountAmount") {
      if (!item.discountAmount || !item.discountAmount.hasSource) {
        return renderNoDataCell();
      }
      return shell.escapeHtml(item.discountAmount.label || "—");
    }
    if (columnId === "onecTop150") {
      if (!item.onecTop150 || !item.onecTop150.hasSource) {
        return renderNoDataCell();
      }
      return shell.escapeHtml(item.onecTop150.label || "—");
    }
    if (columnId === "onecCategory") {
      if (!item.onecCategory || !item.onecCategory.hasSource) {
        return renderNoDataCell();
      }
      return shell.escapeHtml(item.onecCategory.label || "—");
    }
    if (columnId === "onecCounterparty") {
      if (!item.onecCounterparty || !item.onecCounterparty.hasSource) {
        return renderNoDataCell();
      }
      return shell.escapeHtml(item.onecCounterparty.label || "—");
    }
    if (columnId === "onecFullName") {
      if (!item.onecFullName || !item.onecFullName.hasSource) {
        return renderNoDataCell();
      }
      return shell.escapeHtml(item.onecFullName.label || "—");
    }
    if (columnId === "onecLegalEntityType") {
      if (!item.onecLegalEntityType || !item.onecLegalEntityType.hasSource) {
        return renderNoDataCell();
      }
      return shell.escapeHtml(item.onecLegalEntityType.label || "—");
    }
    if (columnId === "onecOgrn") {
      if (!item.onecOgrn || !item.onecOgrn.hasSource) {
        return renderNoDataCell();
      }
      return shell.escapeHtml(item.onecOgrn.label || "—");
    }
    if (columnId === "onecPrimaryContract") {
      if (!item.onecPrimaryContract || !item.onecPrimaryContract.hasSource) {
        return renderNoDataCell();
      }
      return shell.escapeHtml(item.onecPrimaryContract.label || "—");
    }
    if (columnId === "onecMainAgreement") {
      if (!item.onecMainAgreement || !item.onecMainAgreement.hasSource) {
        return renderNoDataCell();
      }
      return shell.escapeHtml(item.onecMainAgreement.label || "—");
    }
    return renderNoDataCell();
  }

  function renderLprFieldCell(field) {
    if (!field || !field.hasSource) {
      return renderNoDataCell();
    }
    if (field.value === null || field.value === undefined) {
      return '<span class="clients-phone-muted">—</span>';
    }
    return shell.escapeHtml(field.label || field.value);
  }

  function renderOutletColumnCell(columnId, item) {
    var def = columnDefById("outlets", columnId);
    if (def && !def.hasSource) {
      return renderNoDataCell();
    }
    if (columnId === "clientName") {
      return (
        '<a class="clients-link" href="' +
        clientHref(item.guidClient) +
        '">' +
        shell.escapeHtml(item.clientName) +
        "</a>"
      );
    }
    if (columnId === "outlet") {
      return (
        '<a class="clients-link" href="' +
        outletHref(item.guidClient, item.guidStore) +
        '">' +
        shell.escapeHtml(item.outletLabel || item.guidStore) +
        "</a>"
      );
    }
    if (columnId === "guidStore") {
      return shell.escapeHtml(item.guidStore);
    }
    if (columnId === "address") {
      return shell.escapeHtml(item.address || "—");
    }
    if (columnId === "status") {
      return shell.escapeHtml(item.closureStatusLabel || (item.isClosed ? "Закрыта" : "Открыта"));
    }
    if (columnId === "manager") {
      return renderAssignmentRefCell(item.manager);
    }
    if (columnId === "clientManager") {
      return shell.escapeHtml(item.clientManager.name) + " · " + shell.escapeHtml(item.clientManager.shortId);
    }
    if (columnId === "holding") {
      return shell.escapeHtml(item.holdingName || "—");
    }
    if (columnId === "regional") {
      return renderAssignmentRefCell(item.regionalManager);
    }
    if (columnId === "hardware") {
      return renderAssignmentRefCell(item.hardwareManager);
    }
    if (columnId === "rop") {
      return renderAssignmentRefCell(item.headOfSales);
    }
    if (columnId === "warehouse") {
      if (!item.warehouse || !item.warehouse.hasSource) {
        return renderNoDataCell();
      }
      return shell.escapeHtml(item.warehouse.label || "—");
    }
    if (columnId === "tandoorClub") {
      if (!item.tandoorClub || !item.tandoorClub.hasSource) {
        return renderNoDataCell();
      }
      if (!item.tandoorClub.value) {
        return '<span class="clients-phone-muted">—</span>';
      }
      return shell.escapeHtml(item.tandoorClub.value);
    }
    if (columnId === "bonusTandoorClub") {
      if (!item.bonusTandoorClub || !item.bonusTandoorClub.hasSource) {
        return renderNoDataCell();
      }
      if (item.bonusTandoorClub.value === null || item.bonusTandoorClub.value === undefined) {
        return '<span class="clients-phone-muted">—</span>';
      }
      return shell.escapeHtml(item.bonusTandoorClub.value);
    }
    if (item.lpr) {
      if (columnId === "lprName") return renderLprFieldCell(item.lpr.name);
      if (columnId === "lprPost") return renderLprFieldCell(item.lpr.post);
      if (columnId === "lprPhone") return renderLprFieldCell(item.lpr.phone);
      if (columnId === "lprEmail") return renderLprFieldCell(item.lpr.email);
      if (columnId === "lprDateOfBirth") return renderLprFieldCell(item.lpr.dateOfBirth);
      if (columnId === "lprBonus") return renderLprFieldCell(item.lpr.bonus);
      if (columnId === "lprConditionsBonus") return renderLprFieldCell(item.lpr.conditionsBonus);
    }
    return renderNoDataCell();
  }

  function resultCountLabel(total, entity) {
    if (entity === "outlets") {
      return "Найдено " + total + " торговых точек";
    }
    return "Найдено " + total + " клиентов";
  }

  function listReturnQuery() {
    return window.location.search || "";
  }

  function clientHref(guid) {
    return "/clients/" + encodeURIComponent(guid) + "?return=" + encodeURIComponent(listReturnQuery());
  }

  function outletHref(guidClient, guidStore) {
    return (
      "/clients/" +
      encodeURIComponent(guidClient) +
      "?store=" +
      encodeURIComponent(guidStore) +
      "&return=" +
      encodeURIComponent(listReturnQuery())
    );
  }

  function applyComboboxFilter() {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    var state = currentStateFromForm();
    state.page = 1;
    loadList(state, false);
  }

  function mountFilterComboboxes() {
    ropCombobox = logic.mountAssignmentFilter({
      model: logic.createAssignmentFilterModel(false),
      modeSelect: ropFilterMode,
      input: ropFilterInput,
      hidden: ropFilter,
      tagsEl: ropFilterTags,
      listEl: ropFilterList,
      root: ropFilterWrap,
      listboxId: "rop-filter-list",
      allLabel: "Все РОП",
      missingEntry: ropMissingEntry,
      options: function () {
        return ropOptions;
      },
      onApply: applyComboboxFilter,
    });

    managerCombobox = logic.mountAssignmentFilter({
      model: logic.createAssignmentFilterModel(true),
      modeSelect: managerFilterMode,
      input: managerFilterInput,
      hidden: managerFilter,
      tagsEl: managerFilterTags,
      listEl: managerFilterList,
      root: managerFilterWrap,
      listboxId: "manager-filter-list",
      allLabel: "Все менеджеры",
      missingEntry: managerMissingEntry,
      options: function () {
        return managerComboboxOptions();
      },
      onApply: applyComboboxFilter,
    });

    holdingCombobox = logic.mountCombobox({
      model: logic.createComboboxModel(),
      input: holdingFilterInput,
      hidden: holdingFilter,
      listEl: holdingFilterList,
      root: document.getElementById("holding-combobox"),
      listboxId: "holding-filter-list",
      allLabel: "Все холдинги",
      options: function () {
        return holdingOptions;
      },
      onApplySelection: applyComboboxFilter,
    });

    regionalCombobox = logic.mountAssignmentFilter({
      model: logic.createAssignmentFilterModel(true),
      modeSelect: regionalFilterMode,
      input: regionalFilterInput,
      hidden: regionalFilter,
      tagsEl: regionalFilterTags,
      listEl: regionalFilterList,
      root: regionalFilterWrap,
      listboxId: "regional-filter-list",
      allLabel: "Все региональные",
      missingEntry: regionalMissingEntry,
      options: function () {
        return regionalOptions;
      },
      onApply: applyComboboxFilter,
    });

    if (hardwareFilterInput && hardwareFilter && hardwareFilterList) {
      hardwareCombobox = logic.mountAssignmentFilter({
        model: logic.createAssignmentFilterModel(true),
        modeSelect: hardwareFilterMode,
        input: hardwareFilterInput,
        hidden: hardwareFilter,
        tagsEl: hardwareFilterTags,
        listEl: hardwareFilterList,
        root: hardwareFilterWrap,
        listboxId: "hardware-filter-list",
        allLabel: "Все менеджеры по фурнитуре",
        missingEntry: hardwareMissingEntry,
        options: function () {
          return hardwareOptions;
        },
        onApply: applyComboboxFilter,
      });
    }

    if (outletManagerFilterInput && outletManagerFilter && outletManagerFilterList) {
      outletManagerCombobox = logic.mountAssignmentFilter({
        model: logic.createAssignmentFilterModel(true),
        modeSelect: outletManagerFilterMode,
        input: outletManagerFilterInput,
        hidden: outletManagerFilter,
        tagsEl: outletManagerFilterTags,
        listEl: outletManagerFilterList,
        root: outletManagerFilterWrap,
        listboxId: "outlet-manager-filter-list",
        allLabel: "Все менеджеры ТТ",
        missingEntry: outletManagerMissingEntry,
        options: function () {
          return outletManagerOptions;
        },
        onApply: applyComboboxFilter,
      });
    }
    if (outletRegionalFilterInput && outletRegionalFilter && outletRegionalFilterList) {
      outletRegionalCombobox = logic.mountAssignmentFilter({
        model: logic.createAssignmentFilterModel(true),
        modeSelect: outletRegionalFilterMode,
        input: outletRegionalFilterInput,
        hidden: outletRegionalFilter,
        tagsEl: outletRegionalFilterTags,
        listEl: outletRegionalFilterList,
        root: outletRegionalFilterWrap,
        listboxId: "outlet-regional-filter-list",
        allLabel: "Все региональные ТТ",
        missingEntry: outletRegionalMissingEntry,
        options: function () {
          return regionalOptions;
        },
        onApply: applyComboboxFilter,
      });
    }
    if (outletHardwareFilterInput && outletHardwareFilter && outletHardwareFilterList) {
      outletHardwareCombobox = logic.mountAssignmentFilter({
        model: logic.createAssignmentFilterModel(true),
        modeSelect: outletHardwareFilterMode,
        input: outletHardwareFilterInput,
        hidden: outletHardwareFilter,
        tagsEl: outletHardwareFilterTags,
        listEl: outletHardwareFilterList,
        root: outletHardwareFilterWrap,
        listboxId: "outlet-hardware-filter-list",
        allLabel: "Все менеджеры по фурнитуре ТТ",
        missingEntry: outletHardwareMissingEntry,
        options: function () {
          return hardwareOptions;
        },
        onApply: applyComboboxFilter,
      });
    }
    if (outletRopFilterInput && outletRopFilter && outletRopFilterList) {
      outletRopCombobox = logic.mountAssignmentFilter({
        model: logic.createAssignmentFilterModel(false),
        modeSelect: outletRopFilterMode,
        input: outletRopFilterInput,
        hidden: outletRopFilter,
        tagsEl: outletRopFilterTags,
        listEl: outletRopFilterList,
        root: outletRopFilterWrap,
        listboxId: "outlet-rop-filter-list",
        allLabel: "Все РОП ТТ",
        missingEntry: outletRopMissingEntry,
        options: function () {
          return ropOptions;
        },
        onApply: applyComboboxFilter,
      });
    }

    if (filledFieldFilter) {
      logic.FIELD_FILTER_FILLED_OPTIONS.forEach(function (opt) {
        var optionEl = document.createElement("option");
        optionEl.value = opt.value;
        optionEl.textContent = opt.label;
        filledFieldFilter.appendChild(optionEl);
      });
    }
    if (emptyFieldFilter) {
      logic.FIELD_FILTER_EMPTY_OPTIONS.forEach(function (opt) {
        var optionEl = document.createElement("option");
        optionEl.value = opt.value;
        optionEl.textContent = opt.label;
        emptyFieldFilter.appendChild(optionEl);
      });
    }
  }

  function showAccessDenied() {
    appEl.classList.add("clients-hidden");
    initPanel.classList.add("clients-hidden");
    accessPanel.classList.remove("clients-hidden");
    shell.setPanelMessage(
      accessPanel,
      "forbidden",
      "Нет доступа",
      "У вашей роли нет доступа к разделу «Клиенты».",
      '<a class="workspace-button workspace-button--secondary" href="/profile">В профиль</a>',
    );
  }

  function showInitError(title, text) {
    appEl.classList.add("clients-hidden");
    accessPanel.classList.add("clients-hidden");
    initPanel.classList.remove("clients-hidden");
    shell.setPanelMessage(
      initPanel,
      "error",
      title,
      text,
      '<button type="button" class="workspace-button workspace-button--primary" id="retry-init">Повторить</button>',
    );
    document.getElementById("retry-init")?.addEventListener("click", function () {
      initializeWorkspace();
    });
  }

  function showAppShell() {
    accessPanel.classList.add("clients-hidden");
    initPanel.classList.add("clients-hidden");
    appEl.classList.remove("clients-hidden");
  }

  function showResultsState(kind, title, text, actionHtml) {
    resultsContentEl.classList.add("clients-hidden");
    paginationEl.classList.add("clients-hidden");
    resultsStateEl.classList.remove("clients-hidden");
    shell.setPanelMessage(resultsStateEl, kind, title, text, actionHtml);
  }

  function showResultsContent() {
    resultsStateEl.classList.add("clients-hidden");
    resultsContentEl.classList.remove("clients-hidden");
    paginationEl.classList.remove("clients-hidden");
  }

  function renderPhonePreview(preview) {
    if (!preview || !preview.primary) {
      return '<span class="clients-phone-muted">Не указан</span>';
    }
    var html = shell.escapeHtml(preview.primary);
    if (preview.extraCount > 0) {
      html += ' <span class="clients-phone-muted">ещё ' + preview.extraCount + "</span>";
    }
    return html;
  }

  function renderHoldingCell(item) {
    if (!item.holding.id) {
      return '<span class="clients-phone-muted">—</span>';
    }
    return (
      '<a class="clients-link clients-link--filter" href="/clients?holding=' +
      encodeURIComponent(item.holding.id) +
      '">' +
      shell.escapeHtml(item.holding.name) +
      "</a>"
    );
  }

  function renderTeamCell(item) {
    if (!item.teamContext) {
      return '<span class="clients-phone-muted">—</span>';
    }
    if (item.teamContext.label) {
      return shell.escapeHtml(item.teamContext.label);
    }
    if (item.teamContext.unassignedReason) {
      return '<span class="clients-tag clients-tag--warn">' + shell.escapeHtml(item.teamContext.unassignedReason) + "</span>";
    }
    return '<span class="clients-phone-muted">—</span>';
  }

  function renderReviewCell(item) {
    if (!item.review) {
      return '<span class="clients-phone-muted">Не проверен</span>';
    }
    var html = shell.escapeHtml(item.review.stateLabel || item.review.state);
    if (item.review.decisionLabel) {
      html += '<br><span class="clients-phone-muted">' + shell.escapeHtml(item.review.decisionLabel) + "</span>";
    }
    if (item.review.transferStatus === "proposed") {
      html += '<br><span class="clients-tag">Предложена передача</span>';
    } else if (item.review.transferStatus === "confirmed_in_1c") {
      html += '<br><span class="clients-tag clients-tag--ok">Передан (1С)</span>';
    }
    if (item.review.isStale) {
      html += '<br><span class="clients-tag clients-tag--warn">Устарело</span>';
    }
    return html;
  }

  function renderOutletRows(items, state) {
    renderTableHead(state);
    tableBody.innerHTML = items
      .map(function (item) {
        return (
          "<tr>" +
          visibleColumnIds
            .map(function (columnId) {
              return "<td>" + renderOutletColumnCell(columnId, item) + "</td>";
            })
            .join("") +
          "</tr>"
        );
      })
      .join("");

    cardsEl.innerHTML = items
      .map(function (item) {
        return (
          '<article class="clients-card">' +
          visibleColumnIds
            .map(function (columnId) {
              var def = columnDefById("outlets", columnId);
              if (!def) {
                return "";
              }
              return (
                '<p class="clients-card__line"><strong>' +
                shell.escapeHtml(def.label) +
                ":</strong> " +
                renderOutletColumnCell(columnId, item) +
                "</p>"
              );
            })
            .join("") +
          "</article>"
        );
      })
      .join("");
  }

  function renderRows(items, state) {
    renderTableHead(state);
    tableBody.innerHTML = items
      .map(function (item) {
        return (
          "<tr>" +
          visibleColumnIds
            .map(function (columnId) {
              return "<td>" + renderClientColumnCell(columnId, item) + "</td>";
            })
            .join("") +
          "</tr>"
        );
      })
      .join("");

    cardsEl.innerHTML = items
      .map(function (item) {
        return (
          '<article class="clients-card">' +
          visibleColumnIds
            .map(function (columnId) {
              var def = columnDefById("clients", columnId);
              if (!def) {
                return "";
              }
              if (columnId === "name") {
                return (
                  '<h2 class="clients-card__title"><a class="clients-link" href="' +
                  clientHref(item.guid) +
                  '">' +
                  shell.escapeHtml(item.name) +
                  "</a></h2>"
                );
              }
              return (
                '<p class="clients-card__line"><strong>' +
                shell.escapeHtml(def.label) +
                ":</strong> " +
                renderClientColumnCell(columnId, item) +
                "</p>"
              );
            })
            .join("") +
          "</article>"
        );
      })
      .join("");
  }

  function renderColumnPicker(state) {
    if (!columnsPickerEl) {
      return;
    }
    var entity = state.entity || "clients";
    var view = state.view || "all";
    var defs = logic.columnDefinitions(entity).filter(function (col) {
      if (!col.viewModes || col.viewModes.length === 0) {
        return true;
      }
      return col.viewModes.indexOf(view) !== -1;
    });
    columnsPickerEl.innerHTML =
      '<div class="clients-columns-picker__grid">' +
      defs
        .map(function (col) {
          var checked = visibleColumnIds.indexOf(col.id) !== -1;
          var disabled = col.locked;
          return (
            '<label class="clients-columns-picker__item' +
            (disabled ? " clients-columns-picker__item--disabled" : "") +
            '">' +
            '<input type="checkbox" data-column-id="' +
            shell.escapeHtml(col.id) +
            '"' +
            (checked ? " checked" : "") +
            (disabled ? " disabled" : "") +
            " />" +
            "<span>" +
            shell.escapeHtml(col.label) +
            (col.hasSource ? "" : " · " + shell.escapeHtml(logic.NO_DATA_LABEL)) +
            "</span>" +
            "</label>"
          );
        })
        .join("") +
      "</div>";
    columnsPickerEl.querySelectorAll("input[type=checkbox]").forEach(function (input) {
      input.addEventListener("change", function () {
        var columnId = input.getAttribute("data-column-id") || "";
        var nextIds = logic.toggleColumnSelection(
          visibleColumnIds,
          columnId,
          input.checked,
          entity,
          view,
        );
        visibleColumnIds = nextIds;
        logic.persistStoredColumnIds(columnsStorageKey(entity), nextIds);
        navigateState(
          Object.assign({}, currentStateFromForm(), {
            cols: columnsParamFromIds(nextIds),
            page: 1,
          }),
        );
      });
    });
  }

  function toggleColumnPicker(state) {
    if (!columnsPickerEl) {
      return;
    }
    var willOpen = columnsPickerEl.classList.contains("clients-hidden");
    if (willOpen) {
      renderColumnPicker(state);
      columnsPickerEl.classList.remove("clients-hidden");
    } else {
      columnsPickerEl.classList.add("clients-hidden");
    }
  }

  function renderPagination(state, totalPages) {
    if (totalPages <= 1) {
      paginationEl.innerHTML = "";
      return;
    }
    var prevDisabled = state.page <= 1;
    var nextDisabled = state.page >= totalPages;
    paginationEl.innerHTML =
      '<button type="button" class="workspace-button workspace-button--secondary" id="page-prev"' +
      (prevDisabled ? " disabled" : "") +
      ">Назад</button>" +
      '<span>Страница ' +
      state.page +
      " из " +
      totalPages +
      "</span>" +
      '<button type="button" class="workspace-button workspace-button--secondary" id="page-next"' +
      (nextDisabled ? " disabled" : "") +
      ">Вперёд</button>";

    document.getElementById("page-prev")?.addEventListener("click", function () {
      if (state.page <= 1) return;
      cancelScheduledLoad();
      invalidateInFlightRequests();
      loadList(Object.assign({}, state, { page: state.page - 1 }), false);
    });
    document.getElementById("page-next")?.addEventListener("click", function () {
      if (state.page >= totalPages) return;
      cancelScheduledLoad();
      invalidateInFlightRequests();
      loadList(Object.assign({}, state, { page: state.page + 1 }), false);
    });
  }

  function buildQueryString(state) {
    var params = new URLSearchParams(logic.buildListQueryString(state));
    params.set("pageSize", "50");
    return params.toString();
  }

  function navigateResponsible(state, manager, kind, entityMode) {
    var next = {
      view: "teams",
      ropEmployee: state.ropEmployee,
      rop: "",
      portfolio: "",
      manager: kind === "manager" ? manager.employeeGuid : "",
      regionalManager: kind === "regional" ? manager.employeeGuid : "",
      hardwareManager: kind === "hardware" ? manager.employeeGuid : "",
      responsibleKind: kind,
      entity: entityMode || "clients",
      page: 1,
    };
    teamContext.managerName = manager.name || "";
    navigateState(next);
  }

  function updateViewSwitcherActive(view) {
    viewSwitcherEl.querySelectorAll(".clients-view-switcher__btn").forEach(function (btn) {
      btn.classList.toggle("clients-view-switcher__btn--active", btn.getAttribute("data-view") === view);
    });
  }

  function updateDesignViewSwitcherLabels() {
    if (!viewAllTabEl || !viewTeamsTabEl) {
      return;
    }
    if (isRopDesignSession()) {
      viewAllTabEl.textContent = "Клиенты команды";
      viewTeamsTabEl.textContent = "Моя команда";
    } else {
      viewAllTabEl.textContent = "Все клиенты";
      viewTeamsTabEl.textContent = "По командам";
    }
    if (viewReviewTab) {
      viewReviewTab.textContent = usesDirectorLayout() ? "Ревизии" : "Требуют проверки";
    }
  }

  function updateViewChrome(state) {
    var isReview = state.view === "review";
    var isTeams = state.view === "teams";
    var isCompleteness = state.view === "completeness";
    var isOutlets = (state.entity || "clients") === "outlets";
    var showAssignmentFilters =
      rolePresentation &&
      rolePresentation.showManagerTeamFilter &&
      !isTeams &&
      !isReview;
    var isRegionalRole = rolePresentation && rolePresentation.businessRole === "regional_manager";
    var showManagerFilterInput =
      showAssignmentFilters ||
      isCompleteness ||
      (isRegionalRole && !isTeams && !isReview);
    ropFilterWrap?.classList.toggle("clients-hidden", !showAssignmentFilters && !isCompleteness);
    managerFilterWrap?.classList.toggle("clients-hidden", !showManagerFilterInput);
    managerFilterWrap?.classList.remove("clients-field--label-only");
    document.getElementById("manager-combobox")?.classList.toggle("clients-hidden", !showManagerFilterInput);
    filtersScopeLabelEl?.classList.toggle(
      "clients-hidden",
      !isRegionalRole || isTeams || isReview || isCompleteness,
    );
    holdingFilterWrap?.classList.toggle("clients-hidden", isCompleteness || isTeams);
    phoneFilter.closest(".clients-field")?.classList.toggle("clients-hidden", isCompleteness || isTeams);
    entitySwitcherEl.classList.toggle(
      "clients-hidden",
      !isCompleteness &&
        !(
          rolePresentation &&
          rolePresentation.allowedEntities &&
          rolePresentation.allowedEntities.length > 1 &&
          rolePresentation.showEntitySwitcher !== false
        ),
    );
    completenessReasonFilterWrap?.classList.toggle("clients-hidden", !isCompleteness);
    var showOutletDerivedFilters = !isTeams && !isReview && state.view === "all";
    outletsFilterWrap.classList.toggle("clients-hidden", state.view === "all" || isCompleteness);
    outletStatusFilterWrap.classList.toggle("clients-hidden", !showOutletDerivedFilters || isCompleteness);
    warehouseFilterWrap.classList.toggle("clients-hidden", !showOutletDerivedFilters || isCompleteness);
    regionalFilterWrap.classList.toggle(
      "clients-hidden",
      !(showAssignmentFilters || isCompleteness) || isRegionalRole,
    );
    hardwareFilterWrap?.classList.toggle(
      "clients-hidden",
      !(showAssignmentFilters || isCompleteness) || isRegionalRole,
    );
    tandoorFilterWrap.classList.toggle("clients-hidden", !showOutletDerivedFilters || isCompleteness);
    fieldFiltersWrap?.classList.toggle("clients-hidden", !showOutletDerivedFilters || isCompleteness);
    document.querySelectorAll(".clients-field--clients-only").forEach(function (el) {
      el.classList.toggle("clients-hidden", !showOutletDerivedFilters || isCompleteness || isOutlets);
    });
    var showOutletLevelAssignments = showAssignmentFilters && !isOutlets;
    outletManagerFilterWrap?.classList.toggle("clients-hidden", !showOutletLevelAssignments);
    outletRegionalFilterWrap?.classList.toggle("clients-hidden", !showOutletLevelAssignments || isRegionalRole);
    outletHardwareFilterWrap?.classList.toggle("clients-hidden", !showOutletLevelAssignments || isRegionalRole);
    outletRopFilterWrap?.classList.toggle("clients-hidden", !showOutletLevelAssignments);
    updateResponsibleFilterLabels(isOutlets);
    reviewStateFilterWrap.classList.toggle("clients-hidden", !isReview);
    reviewDecisionFilterWrap.classList.toggle("clients-hidden", !isReview);
    unassignedFilterWrap.classList.toggle("clients-hidden", !isReview);
    var branchList = logic.isBranchPortfolioList(state);
    var responsibleList = logic.hasResponsibleSelection(state);
    teamsPanelEl.classList.toggle("clients-hidden", !isTeams || branchList || responsibleList);
    var reviewEmployeePick = isReview && Boolean(state.unassignedCategory) && !state.manager;
    unassignedPanelEl.classList.toggle("clients-hidden", !isReview);
    resultsContentEl.classList.toggle(
      "clients-hidden",
      (isTeams && !branchList && !responsibleList) || reviewEmployeePick,
    );
    paginationEl.classList.toggle(
      "clients-hidden",
      (isTeams && !branchList && !responsibleList) || reviewEmployeePick,
    );
    var isRopTeamHome =
      isRopDesignSession() && isTeams && !branchList && !responsibleList && Boolean(state.ropEmployee);
    var isDirectorTeamsSurface =
      usesDirectorLayout() && isTeams && !branchList && !responsibleList;
    var isDirectorTeamsOverview = isDirectorTeamsSurface && !state.ropEmployee;
    var isTeamsSurface = isDirectorTeamsOverview || isRopTeamHome;
    document.body.classList.toggle("clients-teams-surface", Boolean(isTeamsSurface));
    if (incompleteStatsCompactEl) {
      incompleteStatsCompactEl.classList.toggle(
        "clients-hidden",
        !usesDirectorLayout() || !isTeamsSurface,
      );
    }
    document
      .querySelector(".clients-toolbar")
      ?.classList.toggle("clients-hidden", isRopTeamHome || isDirectorTeamsSurface);
    document
      .querySelector(".clients-results-shell")
      ?.classList.toggle("clients-hidden", isRopTeamHome || isDirectorTeamsSurface);
    if (pageSubtitleEl && usesDirectorLayout() && isTeams && !branchList && !responsibleList) {
      pageSubtitleEl.classList.add("clients-hidden");
    }
    updateDesignViewSwitcherLabels();
    applyPortfolioDesignChrome(rolePresentation, currentUser, state);
    if (usesDirectorLayout()) {
      loadDirectorStats();
      mountDirectorStatLinks();
    } else if (isRopDesignSession() && isTeams) {
      loadRopTeamStats(state);
      mountRopStatLinks(state);
    }
    updateResultsTitle(state);
    updateActiveFiltersBadge(state);
    updateMobileFiltersCollapse(state);
    renderBreadcrumbs(state);
  }

  function updateMobileFiltersCollapse(state) {
    var role = rolePresentation && rolePresentation.businessRole;
    var branchList = logic.isBranchPortfolioList(state);
    var responsibleList = logic.hasResponsibleSelection(state);
    var isDirectorTeamsOverview =
      (role === "director" || role === "admin") &&
      (state.view || "all") === "teams" &&
      !branchList &&
      !responsibleList &&
      !state.ropEmployee;
    var collapseMobileFilters =
      ((role === "manager" || role === "regional_manager") && (state.view || "all") === "all") ||
      ((role === "director" || role === "admin") && (state.view || "all") === "all") ||
      isDirectorTeamsOverview ||
      (role === "rop" &&
        (state.view || "all") === "teams" &&
        !branchList &&
        !responsibleList &&
        Boolean(state.ropEmployee)) ||
      (role === "rop" && (state.view || "all") === "teams" && (branchList || responsibleList)) ||
      ((role === "director" || role === "admin") &&
        (state.view || "all") === "teams" &&
        (branchList || responsibleList));
    document.body.classList.toggle("clients-mobile-filters-collapsed", Boolean(collapseMobileFilters));
    if (!collapseMobileFilters && filtersPanelEl) {
      filtersPanelEl.classList.add("clients-filters-panel--expanded");
    }
  }

  function ropTeamHomeHref(state) {
    if (!state.ropEmployee) {
      return "/clients?view=teams";
    }
    return "/clients?view=teams&ropEmployee=" + encodeURIComponent(state.ropEmployee);
  }

  function renderBreadcrumbs(state) {
    if (state.view === "all") {
      breadcrumbsEl.classList.add("clients-hidden");
      if (breadcrumbsRowEl) {
        breadcrumbsRowEl.innerHTML = "";
      }
      return;
    }
    var parts = [];
    var showBackToTeam = false;
    if (state.view === "teams") {
      if (usesDirectorLayout()) {
        var directorRootLabel = "Все команды";
        var directorRootHref =
          state.teamSource === "onec" ? "/clients?view=teams&teamSource=onec" : "/clients?view=teams";
        if (logic.hasResponsibleSelection(state)) {
          parts.push({ label: directorRootLabel, href: directorRootHref });
          if (state.ropEmployee) {
            parts.push({
              label: teamContext.ropName || "РОП",
              href:
                "/clients?view=teams&ropEmployee=" + encodeURIComponent(state.ropEmployee),
            });
          }
          parts.push({ label: teamContext.managerName || "Сотрудник", href: null });
          showBackToTeam = true;
        } else if (logic.isBranchPortfolioList(state)) {
          parts.push({ label: directorRootLabel, href: directorRootHref });
          if (state.ropEmployee) {
            parts.push({
              label: teamContext.ropName || "РОП",
              href:
                "/clients?view=teams&ropEmployee=" + encodeURIComponent(state.ropEmployee),
            });
          }
          parts.push({
            label: state.portfolio === "outlets" ? "ТТ ветки" : "Клиенты ветки",
            href: null,
          });
          showBackToTeam = true;
        }
      } else {
        var teamRootLabel = isRopDesignSession() ? "Моя команда" : "По командам";
        var teamRootHref = isRopDesignSession() ? ropTeamHomeHref(state) : "/clients?view=teams";
        if (isRopDesignSession()) {
          if (logic.hasResponsibleSelection(state)) {
            parts.push({ label: teamRootLabel, href: teamRootHref });
            var entityLabel = (state.entity || "clients") === "outlets" ? "Торговые точки" : "Клиенты";
            parts.push({ label: teamContext.managerName || "Сотрудник", href: null });
            parts.push({ label: entityLabel, href: null });
            showBackToTeam = true;
          } else if (logic.isBranchPortfolioList(state)) {
            parts.push({ label: teamRootLabel, href: teamRootHref });
            parts.push({
              label: state.portfolio === "outlets" ? "ТТ ветки" : "Клиенты ветки",
              href: null,
            });
            showBackToTeam = true;
          }
        } else {
          parts.push({ label: teamRootLabel, href: teamRootHref });
          if (state.ropEmployee) {
            parts.push({
              label: teamContext.ropName || "РОП",
              href: "/clients?view=teams&ropEmployee=" + encodeURIComponent(state.ropEmployee),
            });
          }
          if (state.portfolio === "clients") {
            parts.push({ label: "Клиенты ветки", href: null });
          } else if (state.portfolio === "outlets") {
            parts.push({ label: "ТТ ветки", href: null });
          }
          if (logic.hasResponsibleSelection(state)) {
            parts.push({ label: teamContext.managerName || "Ответственный", href: null });
          }
        }
      }
    } else if (state.view === "completeness") {
      parts.push({ label: "Незаполненные назначения", href: "/clients?view=completeness" });
    } else if (state.view === "review") {
      parts.push({ label: "Ревизия", href: "/clients?view=review" });
      if (state.unassignedCategory) {
        parts.push({
          label: unassignedContext.categoryLabel || "Категория",
          href:
            "/clients?view=review&unassignedCategory=" + encodeURIComponent(state.unassignedCategory),
        });
      }
      if (state.manager && state.unassignedCategory) {
        parts.push({ label: unassignedContext.employeeName || "Ответственный", href: null });
      }
    }
    var trailHtml = parts
      .map(function (part, index) {
        if (!part.href || index === parts.length - 1) {
          return "<span>" + shell.escapeHtml(part.label) + "</span>";
        }
        return '<a class="clients-link" href="' + part.href + '">' + shell.escapeHtml(part.label) + "</a>";
      })
      .join(' <span aria-hidden="true">›</span> ');
    var backLabel = usesDirectorLayout() ? "К командам" : "К команде";
    var backHtml = showBackToTeam
      ? '<button type="button" class="clients-breadcrumbs__back workspace-button workspace-button--ghost" id="clients-breadcrumbs-back">' +
        shell.escapeHtml(backLabel) +
        "</button>"
      : "";
    if (breadcrumbsRowEl) {
      breadcrumbsRowEl.innerHTML = trailHtml + backHtml;
    } else {
      breadcrumbsEl.innerHTML = trailHtml + backHtml;
    }
    var backButton = document.getElementById("clients-breadcrumbs-back");
    if (backButton) {
      backButton.onclick = function () {
        navigateState({
          view: "teams",
          teamSource: state.teamSource || "rop",
          onecTeam: state.onecTeam || "",
          teamExpand: state.teamExpand || [],
          onecPortfolioEmployee: "",
          ropEmployee: usesDirectorLayout() ? "" : state.ropEmployee || "",
          rop: "",
          manager: "",
          regionalManager: "",
          hardwareManager: "",
          portfolio: "",
          responsibleKind: "",
          entity: "clients",
          page: 1,
        });
      };
    }
    breadcrumbsEl.classList.toggle("clients-hidden", parts.length === 0);
  }

  function renderOrgBadge(label) {
    return label
      ? '<span class="clients-phone-muted clients-team-badge">' + shell.escapeHtml(label) + "</span>"
      : "";
  }

  function navigateRopBranchPortfolio(state, portfolio) {
    navigateState({
      view: "teams",
      ropEmployee: state.ropEmployee,
      rop: "",
      manager: "",
      regionalManager: "",
      hardwareManager: "",
      portfolio: portfolio,
      responsibleKind: "",
      entity: portfolio === "outlets" ? "outlets" : "clients",
      page: 1,
    });
  }

  function rememberRopName(ropEmployeeGuid) {
    var match = (teamContext.rops || []).find(function (item) {
      return item.employeeGuid === ropEmployeeGuid;
    });
    if (match) {
      teamContext.ropName = match.name || teamContext.ropName;
    }
  }

  function navigateDirectorBranchPortfolio(ropEmployeeGuid, portfolio) {
    rememberRopName(ropEmployeeGuid);
    navigateState({
      view: "teams",
      ropEmployee: ropEmployeeGuid,
      rop: "",
      manager: "",
      regionalManager: "",
      hardwareManager: "",
      portfolio: portfolio,
      responsibleKind: "",
      entity: portfolio === "outlets" ? "outlets" : "clients",
      page: 1,
    });
  }

  function navigateDirectorResponsible(ropEmployeeGuid, manager, kind, entityMode) {
    rememberRopName(ropEmployeeGuid);
    navigateState({
      view: "teams",
      ropEmployee: ropEmployeeGuid,
      rop: "",
      portfolio: "",
      manager: kind === "manager" ? manager.employeeGuid : "",
      regionalManager: kind === "regional" ? manager.employeeGuid : "",
      hardwareManager: kind === "hardware" ? manager.employeeGuid : "",
      responsibleKind: kind,
      entity: entityMode || "clients",
      page: 1,
    });
    teamContext.managerName = manager.name || "";
  }

  function mountRopStatLinks(state) {
    if (!isRopDesignSession()) {
      return;
    }
    var clientsStat = document.getElementById("clients-stat-clients");
    var outletsStat = document.getElementById("clients-stat-outlets");
    clientsStat?.classList.add("clients-stat__value--link");
    outletsStat?.classList.add("clients-stat__value--link");
    if (clientsStat && !clientsStat.dataset.ropStatBound) {
      clientsStat.dataset.ropStatBound = "1";
      clientsStat.addEventListener("click", function () {
        navigateRopBranchPortfolio(currentStateFromForm(), "clients");
      });
    }
    if (outletsStat && !outletsStat.dataset.ropStatBound) {
      outletsStat.dataset.ropStatBound = "1";
      outletsStat.addEventListener("click", function () {
        navigateRopBranchPortfolio(currentStateFromForm(), "outlets");
      });
    }
  }

  function renderResponsibleCountButton(manager, entityMode, count, label) {
    if (count > 0) {
      return (
        '<button type="button" class="clients-team-member-row__count" data-responsible-entity="' +
        shell.escapeHtml(entityMode) +
        '" data-responsible-kind="' +
        shell.escapeHtml(manager.kind) +
        '" data-manager="' +
        shell.escapeHtml(manager.employeeGuid) +
        '">' +
        shell.escapeHtml(String(count) + " " + label) +
        "</button>"
      );
    }
    return (
      '<span class="clients-team-member-row__count clients-team-member-row__count--empty">' +
      shell.escapeHtml("0 " + label) +
      "</span>"
    );
  }

  function buildTeamCardGroupsHtml(managers) {
    var grouped = { manager: [], regional: [], hardware: [] };
    (managers || []).forEach(function (manager) {
      if (grouped[manager.kind]) {
        grouped[manager.kind].push(manager);
      }
    });
    return ["manager", "regional", "hardware"]
      .map(function (kind) {
        var members = grouped[kind];
        if (!members || members.length === 0) {
          return "";
        }
        return (
          '<section class="clients-team-group">' +
          '<h3 class="clients-team-group__title">' +
          shell.escapeHtml(RESPONSIBLE_GROUP_LABELS[kind] || kind) +
          "</h3>" +
          '<div class="clients-team-group__list">' +
          members
            .map(function (manager) {
              var displayName = manager.name || manager.shortId || manager.employeeGuid;
              return (
                '<div class="clients-team-member-row">' +
                '<div class="clients-team-member-row__main">' +
                '<span class="clients-team-member-row__avatar" aria-hidden="true">' +
                shell.escapeHtml(initialsFromName(displayName)) +
                "</span>" +
                '<div class="clients-team-member-row__text">' +
                '<span class="clients-team-member-row__name">' +
                shell.escapeHtml(displayName) +
                "</span>" +
                '<span class="clients-team-member-row__kind">' +
                shell.escapeHtml(RESPONSIBLE_KIND_LABELS[manager.kind] || manager.kind) +
                "</span>" +
                (manager.hasLinkedAccount
                  ? ""
                  : '<span class="clients-team-member-row__badge">Нет аккаунта ЛК</span>') +
                (manager.rosterInOpt === false
                  ? '<span class="clients-team-member-row__badge">Вне справочника ОПТ</span>'
                  : "") +
                "</div></div>" +
                '<div class="clients-team-member-row__counts">' +
                renderResponsibleCountButton(manager, "clients", manager.clientCount, "клиентов") +
                renderResponsibleCountButton(manager, "outlets", manager.outletCount, "ТТ") +
                "</div></div>"
              );
            })
            .join("") +
          "</div></section>"
        );
      })
      .join("");
  }

  function buildTeamCardShellHtml(summary, managers, options) {
    var opts = options || {};
    var ropTitle = summary?.name || "РОП";
    var statsHtml =
      '<div class="clients-team-card__stats" aria-label="Итоги ветки">' +
      '<button type="button" class="clients-team-card__stat" data-branch-portfolio="clients">' +
      '<span class="clients-team-card__stat-value">' +
      shell.escapeHtml(String(summary?.uniqueClientCount ?? "—")) +
      "</span>" +
      '<span class="clients-team-card__stat-label">Клиенты ветки</span>' +
      "</button>" +
      '<button type="button" class="clients-team-card__stat" data-branch-portfolio="outlets">' +
      '<span class="clients-team-card__stat-value">' +
      shell.escapeHtml(String(summary?.uniqueOutletCount ?? "—")) +
      "</span>" +
      '<span class="clients-team-card__stat-label">ТТ ветки</span>' +
      "</button>" +
      '<div class="clients-team-card__stat clients-team-card__stat--static">' +
      '<span class="clients-team-card__stat-value">' +
      shell.escapeHtml(String(summary?.teamMemberCount ?? "—")) +
      "</span>" +
      '<span class="clients-team-card__stat-label">Сотрудники</span>' +
      "</div>" +
      "</div>";
    var groupsHtml = buildTeamCardGroupsHtml(managers);
    var emptyHtml = !groupsHtml
      ? '<p class="clients-team-empty">Нет назначенных сотрудников в ветке.</p>'
      : "";
    var shellClass = "clients-team-card-shell" + (opts.gridItem ? " clients-team-card-shell--grid-item" : "");
    var ropAttr = summary?.employeeGuid
      ? ' data-rop-employee="' + shell.escapeHtml(summary.employeeGuid) + '"'
      : "";
    return (
      '<article class="' +
      shellClass +
      '"' +
      ropAttr +
      ">" +
      '<header class="clients-team-card-shell__head">' +
      "<h2 class=\"clients-team-card-shell__title\">" +
      shell.escapeHtml(ropTitle) +
      "</h2>" +
      (opts.limitationNote
        ? '<p class="clients-team-card-shell__note">' + shell.escapeHtml(opts.limitationNote) + "</p>"
        : "") +
      "</header>" +
      statsHtml +
      groupsHtml +
      emptyHtml +
      "</article>"
    );
  }

  function bindTeamCardPanelEvents(container, context) {
    var ctx = context || {};
    var ropEmployeeGuid = ctx.ropEmployeeGuid || "";
    var managers = ctx.managers || [];
    var state = ctx.state;
    container.querySelectorAll("[data-branch-portfolio]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var portfolio = btn.getAttribute("data-branch-portfolio") || "clients";
        var card = btn.closest("[data-rop-employee]");
        var cardRop = card ? card.getAttribute("data-rop-employee") : ropEmployeeGuid;
        if (usesDirectorLayout() && cardRop) {
          navigateDirectorBranchPortfolio(cardRop, portfolio);
          return;
        }
        navigateRopBranchPortfolio(state, portfolio);
      });
    });
    container.querySelectorAll("[data-responsible-entity]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var managerGuid = btn.getAttribute("data-manager");
        var kind = btn.getAttribute("data-responsible-kind") || "manager";
        var entityMode = btn.getAttribute("data-responsible-entity") || "clients";
        var card = btn.closest("[data-rop-employee]");
        var cardRop = card ? card.getAttribute("data-rop-employee") : ropEmployeeGuid;
        var cardManagers = managers;
        if (cardRop) {
          var teamEntry = (teamContext.ropTeams || []).find(function (item) {
            return item.summary && item.summary.employeeGuid === cardRop;
          });
          if (teamEntry) {
            cardManagers = teamEntry.managers;
          }
        }
        var match = cardManagers.find(function (item) {
          return item.employeeGuid === managerGuid && item.kind === kind;
        });
        if (!match) {
          return;
        }
        if (usesDirectorLayout() && cardRop) {
          navigateDirectorResponsible(cardRop, match, kind, entityMode);
          return;
        }
        navigateResponsible(state, match, kind, entityMode);
      });
    });
  }

  function renderTeamsPanel(state) {
    if (
      state.view !== "teams" ||
      logic.isBranchPortfolioList(state) ||
      logic.hasResponsibleSelection(state)
    ) {
      teamsPanelEl.innerHTML = "";
      teamsPanelEl.removeAttribute("data-onec-teams-ready");
      teamsPanelEl.__onecOverviewHtml = "";
      onecTeamsOverviewRenderSignature = "";
      return;
    }
    if ((isRopDesignSession() || usesDirectorLayout()) && state.ropEmployee && !usesOnecTeamSource(state)) {
      renderCompactRopTeamPanel(state);
      return;
    }
    if ((usesDirectorLayout() && !state.ropEmployee) || (isRopDesignSession() && usesOnecTeamSource(state))) {
      if (usesOnecTeamSource(state)) {
        renderOnecTeamsOverview(state);
      } else if (usesDirectorLayout() && !state.ropEmployee) {
        renderCompactTeamsOverview(state);
      }
      return;
    }
    if (!state.ropEmployee) {
      var directorHtml = "";
      if (teamContext.director && !usesDirectorLayout()) {
        directorHtml =
          '<div class="clients-team-director">' +
          "<strong>" +
          shell.escapeHtml(teamContext.director.name) +
          "</strong> · директор" +
          renderOrgBadge(teamContext.director.hasLinkedAccount ? "" : "Нет аккаунта ЛК") +
          '<p class="clients-phone-muted">' +
          shell.escapeHtml(teamContext.director.note || "") +
          "</p></div>";
      }
      var undefinedHtml =
        (teamContext.undefinedTeam || []).length > 0
          ? '<div class="clients-team-section"><h3 class="clients-team-section__title">Команда не определена</h3><div class="clients-teams-list">' +
            teamContext.undefinedTeam
              .map(function (member) {
                return (
                  '<div class="clients-team-card clients-team-card--static">' +
                  "<strong>" +
                  shell.escapeHtml(member.name) +
                  "</strong>" +
                  renderOrgBadge(member.rosterPost || "") +
                  renderOrgBadge(member.hasLinkedAccount ? "" : "Нет аккаунта ЛК") +
                  "</div>"
                );
              })
              .join("") +
            "</div></div>"
          : "";
      teamsPanelEl.innerHTML =
        directorHtml +
        (teamContext.limitationNote
          ? '<p class="clients-phone-muted">' + shell.escapeHtml(teamContext.limitationNote) + "</p>"
          : "") +
        '<div class="clients-teams-list">' +
        (teamContext.rops || [])
          .map(function (rop) {
            var note = rop.portfolioNote ? " · " + rop.portfolioNote : "";
            return (
              '<button type="button" class="clients-team-card" data-rop-employee="' +
              shell.escapeHtml(rop.employeeGuid) +
              '">' +
              "<strong>" +
              shell.escapeHtml(rop.name) +
              "</strong>" +
              renderOrgBadge(rop.hasLinkedAccount ? "" : "Нет аккаунта ЛК") +
              '<span class="clients-phone-muted">' +
              (rop.teamMemberCount ?? rop.managerCount) +
              " ответств. · " +
              '<button type="button" class="clients-inline-link" data-portfolio="clients" data-rop-employee="' +
              shell.escapeHtml(rop.employeeGuid) +
              '">' +
              rop.uniqueClientCount +
              " клиентов</button> · " +
              '<button type="button" class="clients-inline-link" data-portfolio="outlets" data-rop-employee="' +
              shell.escapeHtml(rop.employeeGuid) +
              '">' +
              rop.uniqueOutletCount +
              " ТТ</button>" +
              shell.escapeHtml(note) +
              "</span>" +
              "</button>"
            );
          })
          .join("") +
        "</div>" +
        undefinedHtml;
      teamsPanelEl.querySelectorAll("[data-rop-employee].clients-team-card").forEach(function (btn) {
        btn.addEventListener("click", function (event) {
          if (event.target.closest("[data-portfolio]")) {
            return;
          }
          var ropGuid = btn.getAttribute("data-rop-employee");
          var match = (teamContext.rops || []).find(function (item) {
            return item.employeeGuid === ropGuid;
          });
          teamContext.ropName = match ? match.name : "";
          navigateState({
            view: "teams",
            ropEmployee: ropGuid,
            rop: "",
            manager: "",
            regionalManager: "",
            hardwareManager: "",
            portfolio: "",
            responsibleKind: "",
            entity: "clients",
            page: 1,
          });
        });
      });
      teamsPanelEl.querySelectorAll("[data-portfolio][data-rop-employee]").forEach(function (btn) {
        btn.addEventListener("click", function (event) {
          event.stopPropagation();
          event.preventDefault();
          var ropGuid = btn.getAttribute("data-rop-employee");
          var portfolio = btn.getAttribute("data-portfolio");
          var match = (teamContext.rops || []).find(function (item) {
            return item.employeeGuid === ropGuid;
          });
          teamContext.ropName = match ? match.name : "";
          navigateState({
            view: "teams",
            ropEmployee: ropGuid,
            rop: "",
            manager: "",
            regionalManager: "",
            hardwareManager: "",
            portfolio: portfolio,
            responsibleKind: "",
            entity: portfolio === "outlets" ? "outlets" : "clients",
            page: 1,
          });
        });
      });
      return;
    }
    teamsPanelEl.innerHTML =
      '<div class="clients-teams-list">' +
      (teamContext.managers || [])
        .map(function (manager) {
          var kindLabel =
            manager.kind === "regional"
              ? "Региональный"
              : manager.kind === "hardware"
                ? "Менеджер по фурнитуре"
                : "Менеджер";
          return (
            '<div class="clients-team-card" data-manager="' +
            shell.escapeHtml(manager.employeeGuid) +
            '">' +
            "<strong>" +
            shell.escapeHtml(manager.name) +
            " · " +
            shell.escapeHtml(manager.shortId) +
            "</strong>" +
            renderOrgBadge(kindLabel) +
            renderOrgBadge(manager.hasLinkedAccount ? "" : "Нет аккаунта ЛК") +
            renderOrgBadge(manager.rosterInOpt === false ? "Вне справочника ОПТ" : "") +
            '<span class="clients-phone-muted">' +
            (manager.clientCount > 0
              ? '<button type="button" class="clients-inline-link" data-responsible-entity="clients" data-responsible-kind="' +
                shell.escapeHtml(manager.kind) +
                '" data-manager="' +
                shell.escapeHtml(manager.employeeGuid) +
                '">' +
                manager.clientCount +
                " клиентов</button>"
              : "0 клиентов") +
            " · " +
            (manager.outletCount > 0
              ? '<button type="button" class="clients-inline-link" data-responsible-entity="outlets" data-responsible-kind="' +
                shell.escapeHtml(manager.kind) +
                '" data-manager="' +
                shell.escapeHtml(manager.employeeGuid) +
                '">' +
                manager.outletCount +
                " ТТ</button>"
              : "0 ТТ") +
            "</span></div>"
          );
        })
        .join("") +
      "</div>";
    teamsPanelEl.querySelectorAll("[data-responsible-entity]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var managerGuid = btn.getAttribute("data-manager");
        var kind = btn.getAttribute("data-responsible-kind") || "manager";
        var entityMode = btn.getAttribute("data-responsible-entity") || "clients";
        var match = (teamContext.managers || []).find(function (item) {
          return item.employeeGuid === managerGuid;
        });
        if (!match) {
          return;
        }
        navigateResponsible(state, match, kind, entityMode);
      });
    });
  }

  function formatCompletenessAssignees(item) {
    var parts = [];
    var known = item.knownAssignees || {};
    if (known.rop && (known.rop.name || known.rop.guid)) {
      parts.push("РОП: " + (known.rop.name || known.rop.guid));
    }
    if (known.manager && (known.manager.name || known.manager.guid)) {
      parts.push("Менеджер: " + (known.manager.name || known.manager.guid));
    }
    if (known.regional && (known.regional.name || known.regional.guid)) {
      parts.push("Региональный: " + (known.regional.name || known.regional.guid));
    }
    return parts.length > 0 ? parts.join(" · ") : "—";
  }

  function completenessCardHref(item) {
    if (item.entityKind === "outlet" && item.guidStore) {
      return (
        "/clients/" +
        encodeURIComponent(item.guidClient) +
        "?store=" +
        encodeURIComponent(item.guidStore)
      );
    }
    return "/clients/" + encodeURIComponent(item.guidClient);
  }

  function renderCompletenessRows(items) {
    tableBody.innerHTML = (items || [])
      .map(function (item) {
        var cardHref = completenessCardHref(item);
        var entityLabel = item.entityKind === "outlet" ? "ТТ" : "Клиент";
        var parentLabel =
          item.entityKind === "outlet" ? item.parentClientName || "—" : "—";
        return (
          "<tr>" +
          "<td>" +
          shell.escapeHtml(entityLabel) +
          "</td>" +
          '<td><a class="clients-link" href="' +
          cardHref +
          '">' +
          shell.escapeHtml(item.name) +
          "</a></td>" +
          "<td>" +
          shell.escapeHtml(parentLabel) +
          "</td>" +
          "<td>" +
          shell.escapeHtml(formatCompletenessAssignees(item)) +
          "</td>" +
          "<td>" +
          shell.escapeHtml((item.reasonLabels || []).join("; ")) +
          "</td>" +
          "<td>" +
          shell.escapeHtml(item.lastImportedAtLabel || "—") +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    cardsEl.innerHTML = (items || [])
      .map(function (item) {
        var cardHref = completenessCardHref(item);
        var entityLabel = item.entityKind === "outlet" ? "ТТ" : "Клиент";
        var parentLabel =
          item.entityKind === "outlet" ? item.parentClientName || "—" : "—";
        return (
          '<article class="clients-card clients-card--completeness">' +
          '<p class="clients-card__line"><strong>Тип:</strong> ' +
          shell.escapeHtml(entityLabel) +
          "</p>" +
          '<h2 class="clients-card__title"><a class="clients-link" href="' +
          cardHref +
          '">' +
          shell.escapeHtml(item.name) +
          "</a></h2>" +
          '<p class="clients-card__line"><strong>Родитель:</strong> ' +
          shell.escapeHtml(parentLabel) +
          "</p>" +
          '<p class="clients-card__line"><strong>Назначения:</strong> ' +
          shell.escapeHtml(formatCompletenessAssignees(item)) +
          "</p>" +
          '<div class="clients-card__reasons" aria-label="Причины">' +
          (item.reasonLabels || [])
            .map(function (label) {
              return (
                '<span class="clients-card__reason-tag">' + shell.escapeHtml(label) + "</span>"
              );
            })
            .join("") +
          "</div>" +
          '<p class="clients-card__line"><strong>Импорт:</strong> ' +
          shell.escapeHtml(item.lastImportedAtLabel || "—") +
          "</p>" +
          "</article>"
        );
      })
      .join("");
  }

  function renderUnassignedPanel(summary, state) {
    if (!summary) {
      unassignedPanelEl.innerHTML = "";
      return;
    }
    unassignedContext.summary = summary;

    if (state && state.unassignedCategory && !state.manager) {
      var employees = (summary.employees || []).filter(function (item) {
        return item.category === state.unassignedCategory;
      });
      var categoryMeta = (summary.categories || []).find(function (item) {
        return item.category === state.unassignedCategory;
      });
      unassignedContext.categoryLabel = categoryMeta ? categoryMeta.label : state.unassignedCategory;
      unassignedPanelEl.innerHTML =
        '<p class="clients-unassigned-note">' +
        shell.escapeHtml(unassignedContext.categoryLabel) +
        " · выберите ответственного</p>" +
        '<div class="clients-unassigned-grid">' +
        employees
          .map(function (employee) {
            return (
              '<button type="button" class="clients-team-card" data-employee="' +
              shell.escapeHtml(employee.employeeGuid) +
              '">' +
              "<strong>" +
              shell.escapeHtml(employee.name + " · " + employee.shortId) +
              "</strong>" +
              '<span class="clients-phone-muted">' +
              employee.clientCount +
              " клиентов</span>" +
              "</button>"
            );
          })
          .join("") +
        "</div>";
      unassignedPanelEl.querySelectorAll("[data-employee]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var employeeGuid = btn.getAttribute("data-employee") || "";
          var match = employees.find(function (item) {
            return item.employeeGuid === employeeGuid;
          });
          unassignedContext.employeeName = match ? match.name : "";
          navigateState(
            Object.assign({}, currentStateFromForm(), {
              manager: employeeGuid,
              page: 1,
            }),
          );
        });
      });
      return;
    }

    unassignedPanelEl.innerHTML =
      '<p class="clients-unassigned-note">' +
      shell.escapeHtml(summary.limitationNote || "") +
      "</p>" +
      '<div class="clients-unassigned-grid">' +
      (summary.categories || [])
        .map(function (cat) {
          return (
            '<button type="button" class="clients-team-card" data-category="' +
            shell.escapeHtml(cat.category) +
            '">' +
            "<strong>" +
            shell.escapeHtml(cat.label) +
            "</strong>" +
            '<span class="clients-phone-muted">' +
            cat.employeeCount +
            " ответст. · " +
            cat.uniqueClientCount +
            " клиентов</span>" +
            "</button>"
          );
        })
        .join("") +
      "</div>";
    unassignedPanelEl.querySelectorAll("[data-category]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        unassignedFilter.value = btn.getAttribute("data-category") || "";
        navigateState(
          Object.assign({}, currentStateFromForm(), {
            unassignedCategory: unassignedFilter.value,
            manager: "",
            page: 1,
          }),
        );
      });
    });
  }

  function navigateState(nextState) {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    loadList(Object.assign({}, currentStateFromForm(), nextState), false);
  }

  function syncTeamContextFromOrgStructure(data, ropEmployeeGuid) {
    teamContext.director = data.director || null;
    teamContext.rops = data.rops || [];
    teamContext.undefinedTeam = data.undefinedTeam || [];
    teamContext.limitationNote = data.limitationNote || "";
    teamContext.loadError = false;
    var match = ropEmployeeGuid
      ? (data.rops || []).find(function (item) {
          return item.employeeGuid === ropEmployeeGuid;
        })
      : (data.rops || [])[0];
    if (match) {
      teamContext.ropSummary = match;
      teamContext.ropName = match.name || teamContext.ropName;
    }
  }

  function buildOnecTeamsApiUrl(state) {
    var params = new URLSearchParams();
    if (state.teamQ) {
      params.set("teamQ", state.teamQ);
    }
    if (state.onecTeam) {
      params.set("onecTeam", state.onecTeam);
    }
    var query = params.toString();
    return "/api/clients/org-structure/onec-teams" + (query ? "?" + query : "");
  }

  function syncOnecTeamContext(data) {
    teamContext.director = data.director || null;
    teamContext.onecGroups = data.groups || [];
    teamContext.onecAllGroups = data.allGroups || [];
    teamContext.onecLoadError = false;
    teamContext.onecErrorMessage = "";
  }

  function loadTeamsContext(state, fetchGeneration) {
    if (state.view !== "teams") {
      return Promise.resolve({ ok: true });
    }
    var requests = [];
    if (usesOnecTeamSource(state) && (!state.ropEmployee || isRopDesignSession())) {
      var fetchGen = fetchGeneration != null ? fetchGeneration : bumpOnecTeamsFetchGeneration();
      var requestState = Object.assign({}, state);
      var requestUrl = buildOnecTeamsApiUrl(requestState);
      requests.push(
        api
          .apiRequest(requestUrl, { signal: nextOnecTeamsFetchSignal() })
          .then(function (result) {
            if (!isOnecTeamsFetchCurrent(fetchGen, requestState)) {
              return result.response.status === 200;
            }
            if (result.response.status === 200 && result.data) {
              syncOnecTeamContext(result.data);
            } else {
              teamContext.onecLoadError = true;
              teamContext.onecErrorMessage =
                api.extractErrorMessage(result.data, "Не удалось загрузить группы из 1С.") ||
                "Не удалось загрузить группы из 1С.";
            }
            return result.response.status === 200;
          })
          .catch(function (error) {
            if (error && error.name === "AbortError") {
              return false;
            }
            if (!isOnecTeamsFetchCurrent(fetchGen, requestState)) {
              return false;
            }
            teamContext.onecLoadError = true;
            teamContext.onecErrorMessage = "Не удалось загрузить группы из 1С.";
            return false;
          }),
      );
    } else if (!state.ropEmployee) {
      requests.push(
        api.apiRequest("/api/clients/org-structure").then(function (result) {
          if (result.response.status === 200 && result.data) {
            syncTeamContextFromOrgStructure(result.data);
            if (usesDirectorLayout()) {
              teamContext.ropTeams = [];
              var compactModule = getCompactTeams();
              if (compactModule) {
                compactModule.resetCache();
              }
            }
          } else {
            teamContext.loadError = true;
          }
          return result.response.status === 200;
        }),
      );
    } else if (!logic.hasResponsibleSelection(state) && !logic.isBranchPortfolioList(state)) {
      requests.push(
        api.apiRequest("/api/clients/org-structure").then(function (result) {
          if (result.response.status === 200 && result.data) {
            syncTeamContextFromOrgStructure(result.data, state.ropEmployee);
          } else {
            teamContext.loadError = true;
          }
          return result.response.status === 200;
        }),
        api
          .apiRequest(
            "/api/clients/org-structure/" + encodeURIComponent(state.ropEmployee) + "/responsibles",
          )
          .then(function (result) {
            if (result.response.status === 200 && result.data) {
              teamContext.managers = result.data.items || [];
            } else {
              teamContext.loadError = true;
            }
            return result.response.status === 200;
          }),
      );
    }
    return Promise.all(requests).then(function (results) {
      return { ok: results.every(Boolean) || results.length === 0 };
    });
  }

  function loadCompletenessQueue(state) {
    var params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.entity) params.set("entity", state.entity);
    if (state.ropEmployee) params.set("ropEmployee", state.ropEmployee);
    if (state.manager) params.set("manager", state.manager);
    if (state.regionalManager) params.set("regionalManager", state.regionalManager);
    (state.completenessReasons || []).forEach(function (reason) {
      params.append("completenessReason", reason);
    });
    params.set("page", String(state.page || 1));
    params.set("pageSize", "50");
    return api.apiRequest("/api/clients/completeness-queue?" + params.toString(), {
      signal: nextListFetchSignal(),
    }).then(function (result) {
      return {
        ok: result.response.status === 200,
        data: result.data,
        status: result.response.status,
        error: result.data,
      };
    });
  }

  function loadUnassignedSummary() {
    return api.apiRequest("/api/clients/unassigned/summary").then(function (result) {
      if (result.response.status !== 200 || !result.data) {
        return { ok: false };
      }
      renderUnassignedPanel(result.data, currentStateFromForm());
      if (unassignedFilter.options.length <= 1) {
        (result.data.categories || []).forEach(function (cat) {
          var opt = document.createElement("option");
          opt.value = cat.category;
          opt.textContent = cat.label;
          unassignedFilter.appendChild(opt);
        });
      }
      return { ok: true };
    });
  }

  function loadReviewOptions() {
    return api.apiRequest("/api/clients/review/options").then(function (result) {
      if (result.response.status !== 200 || !result.data) {
        return { ok: false };
      }
      if (reviewStateFilter.options.length <= 1) {
        (result.data.states || []).forEach(function (item) {
          var opt = document.createElement("option");
          opt.value = item.id;
          opt.textContent = item.label;
          reviewStateFilter.appendChild(opt);
        });
      }
      if (reviewDecisionFilter.options.length <= 1) {
        (result.data.decisions || []).forEach(function (item) {
          var opt = document.createElement("option");
          opt.value = item.id;
          opt.textContent = item.label;
          reviewDecisionFilter.appendChild(opt);
        });
      }
      return { ok: true };
    });
  }

  function renderSyncStatus(data) {
    var formatted = logic.formatSyncStatusParts(data);
    syncStatusEl.textContent = formatted.text + formatted.appendWarning;
    syncStatusEl.className = "clients-sync" + (formatted.warning ? " clients-sync--warning" : "");
  }

  function loadSyncStatus() {
    return api.apiRequest("/api/clients/sync-status").then(function (result) {
      if (result.response.status !== 200 || !result.data) {
        renderSyncStatus(null);
        return { ok: false };
      }
      renderSyncStatus(result.data);
      return { ok: true };
    });
  }

  function shouldShowOnecUpdatePanel() {
    var preview = shell.getPreviewState();
    var actor = shell.getActorUser();
    var isAdminActor =
      (actor && actor.role === "admin") ||
      (rolePresentation && rolePresentation.businessRole === "admin");
    return isAdminActor && (!preview || !preview.active);
  }

  function applyOnecUpdatePanelVisibility() {
    if (!onecUpdatePanelEl) {
      return;
    }
    onecUpdatePanelEl.classList.toggle("clients-hidden", !shouldShowOnecUpdatePanel());
  }

  function renderOnecUpdateStatus(data) {
    if (!onecUpdateStatusEl || !onecUpdateButtonEl) {
      return;
    }
    var formatted = logic.formatOnecUpdateStatusText(data);
    onecUpdateStatusEl.textContent = formatted.text;
    onecUpdateStatusEl.className = "clients-onec-update__status" + (formatted.statusClass ? " " + formatted.statusClass : "");
    onecUpdateButtonEl.disabled = !!formatted.disableButton;

    if (onecUpdateMetaEl) {
      var lines = logic.formatOnecUpdateMetaLines(data);
      if (!lines.length) {
        onecUpdateMetaEl.classList.add("clients-hidden");
        onecUpdateMetaEl.innerHTML = "";
      } else {
        onecUpdateMetaEl.classList.remove("clients-hidden");
        onecUpdateMetaEl.innerHTML = lines
          .map(function (line) {
            return "<dt>" + shell.escapeHtml(line.label) + "</dt><dd>" + shell.escapeHtml(line.value) + "</dd>";
          })
          .join("");
      }
    }
  }

  function scheduleOnecUpdatePoll(data) {
    if (onecUpdatePollTimer) {
      clearTimeout(onecUpdatePollTimer);
      onecUpdatePollTimer = null;
    }
    if (!shouldShowOnecUpdatePanel() || !logic.shouldPollOnecUpdateStatus(data)) {
      return;
    }
    onecUpdatePollTimer = setTimeout(function () {
      loadOnecUpdateStatus(false);
    }, 2000);
  }

  function loadOnecUpdateStatus(refreshSync) {
    applyOnecUpdatePanelVisibility();
    if (!shouldShowOnecUpdatePanel()) {
      return Promise.resolve({ ok: true, skipped: true });
    }
    return api
      .apiRequest("/api/admin/clients/onec-update/status")
      .then(function (result) {
        if (result.response.status !== 200 || !result.data) {
          renderOnecUpdateStatus(null);
          return { ok: false };
        }
        renderOnecUpdateStatus(result.data);
        scheduleOnecUpdatePoll(result.data);
        if (refreshSync) {
          return loadSyncStatus().then(function () {
            return { ok: true };
          });
        }
        return { ok: true };
      })
      .catch(function () {
        renderOnecUpdateStatus(null);
        return { ok: false };
      });
  }

  function startOnecUpdate() {
    if (!onecUpdateButtonEl || onecUpdateButtonEl.disabled) {
      return;
    }
    var confirmed = window.confirm(
      "Запустить обновление клиентов из последнего готового комплекта 1С?\n\n" +
        "Будет загружен подтверждённый комплект с FTP и применён в ЛК. Формирование новой выгрузки в 1С не запускается.",
    );
    if (!confirmed) {
      return;
    }
    onecUpdateButtonEl.disabled = true;
    api
      .apiRequest("/api/admin/clients/onec-update", { method: "POST", body: {} })
      .then(function (result) {
        if (result.response.status === 202 && result.data) {
          return loadOnecUpdateStatus(false);
        }
        var message = api.extractErrorMessage(result.data, "Не удалось запустить обновление из 1С.");
        renderOnecUpdateStatus({
          canStart: false,
          blockedReason: message,
          job: null,
        });
        return { ok: false };
      })
      .catch(function (err) {
        renderOnecUpdateStatus({
          canStart: false,
          blockedReason: api.mapRequestError(err, api.REQUEST_TIMEOUT_MS / 1000),
          job: null,
        });
      });
  }

  function loadOptions() {
    return api.apiRequest("/api/clients/options").then(function (result) {
      if (result.response.status !== 200 || !result.data) {
        return { ok: false, message: api.extractErrorMessage(result.data, "Не удалось загрузить фильтры.") };
      }
      managerOptions = result.data.managers || [];
      outletManagerOptions = result.data.outletManagers || [];
      holdingOptions = result.data.holdings || [];
      regionalOptions = result.data.regionalManagers || [];
      hardwareOptions = result.data.hardwareManagers || [];
      ropOptions = result.data.rops || [];
      if (onecTop150Filter) {
        var top150Current = onecTop150Filter.value;
        onecTop150Filter.innerHTML = '<option value="">Все</option>';
        (result.data.onecTop150Values || []).forEach(function (opt) {
          var option = document.createElement("option");
          option.value = opt.id;
          option.textContent = opt.name;
          onecTop150Filter.appendChild(option);
        });
        onecTop150Filter.value = top150Current;
      }
      if (onecCategoryFilter) {
        var categoryCurrent = onecCategoryFilter.value;
        onecCategoryFilter.innerHTML = '<option value="">Все</option>';
        (result.data.onecCategoryValues || []).forEach(function (opt) {
          var option = document.createElement("option");
          option.value = opt.id;
          option.textContent = opt.name;
          onecCategoryFilter.appendChild(option);
        });
        onecCategoryFilter.value = categoryCurrent;
      }
      if (onecLegalTypeFilter) {
        var legalCurrent = onecLegalTypeFilter.value;
        onecLegalTypeFilter.innerHTML = '<option value="">Все</option>';
        (result.data.onecLegalEntityTypeValues || []).forEach(function (opt) {
          var option = document.createElement("option");
          option.value = opt.id;
          option.textContent = opt.name;
          onecLegalTypeFilter.appendChild(option);
        });
        onecLegalTypeFilter.value = legalCurrent;
      }
      if (ropCombobox) {
        ropCombobox.syncFromUrl(ropFilter.value);
      }
      if (managerCombobox) {
        managerCombobox.syncFromUrl(managerFilter.value);
      }
      if (outletManagerCombobox) {
        outletManagerCombobox.syncFromUrl(outletManagerFilter.value);
      }
      if (holdingCombobox) {
        holdingCombobox.syncFromUrl(holdingFilter.value);
      }
      if (regionalCombobox) {
        regionalCombobox.syncFromUrl(regionalFilter.value);
      }
      if (hardwareCombobox) {
        hardwareCombobox.syncFromUrl(hardwareFilter.value);
      }
      return { ok: true };
    });
  }

  function loadList(state, replaceHistory) {
    cancelScheduledLoad();
    activeRequestId += 1;
    var requestId = activeRequestId;
    applyStateToForm(state);
    writeStateToUrl(state, replaceHistory);
    showAppShell();

    if (state.view === "review" && state.unassignedCategory && !state.manager) {
      showResultsState("loading", "Загрузка нераспределённых…", "", "");
      return loadUnassignedSummary().then(function (ctx) {
        if (!logic.shouldAcceptListResponse(requestId, activeRequestId)) {
          return;
        }
        if (!ctx.ok) {
          showResultsState(
            "error",
            "Не удалось загрузить категорию",
            "Повторите попытку.",
            '<button type="button" class="workspace-button workspace-button--primary" id="retry-load">Повторить</button>',
          );
          document.getElementById("retry-load")?.addEventListener("click", function () {
            loadList(state, true);
          });
          return;
        }
        renderUnassignedPanel(unassignedContext.summary, state);
        updateViewChrome(state);
        showResultsState(
          "empty",
          "Выберите ответственного",
          "Клиенты загружаются после выбора сотрудника в категории.",
          "",
        );
        resultCountEl.textContent = "Ответственные без команды";
      });
    }

    if (state.view === "teams" && !logic.isBranchPortfolioList(state) && !logic.hasResponsibleSelection(state)) {
      showResultsState("loading", "Загрузка команд…", "", "");
      var teamsFetchGen = usesOnecTeamSource(state) ? bumpOnecTeamsFetchGeneration() : onecTeamsFetchGeneration;
      return loadTeamsContext(state, teamsFetchGen).then(function (ctx) {
        if (!logic.shouldAcceptListResponse(requestId, activeRequestId)) {
          return;
        }
        if (usesOnecTeamSource(state) && !isOnecTeamsFetchCurrent(teamsFetchGen, state)) {
          return;
        }
        if (!ctx.ok) {
          showResultsState(
            "error",
            "Не удалось загрузить команду",
            "Повторите попытку.",
            '<button type="button" class="workspace-button workspace-button--primary" id="retry-load">Повторить</button>',
          );
          document.getElementById("retry-load")?.addEventListener("click", function () {
            loadList(state, true);
          });
          return;
        }
        if (isRopDesignSession() && !state.ropEmployee && teamContext.rops.length > 0) {
          var ownRop = teamContext.rops[0];
          loadList(
            Object.assign({}, state, {
              ropEmployee: ownRop.employeeGuid,
              entity: "clients",
              page: 1,
            }),
            replaceHistory,
          );
          return;
        }
        updateViewChrome(state);
        renderTeamsPanel(state);
        if (
          (isRopDesignSession() && state.ropEmployee) ||
          (usesDirectorLayout() && !logic.isBranchPortfolioList(state) && !logic.hasResponsibleSelection(state))
        ) {
          resultsStateEl.classList.add("clients-hidden");
          resultCountEl.textContent = "";
        } else {
          showResultsState(
            "empty",
            state.ropEmployee ? "Выберите ответственного" : "Выберите РОП",
            "Клиенты загружаются после выбора ответственного в ветке РОП.",
            "",
          );
          resultCountEl.textContent = state.ropEmployee ? "Ответственные РОП" : "Структура по назначениям 1С";
        }
      });
    }

    if (state.view === "completeness") {
      showResultsState("loading", "Загрузка очереди…", "", "");
      updateViewChrome(state);
      return loadCompletenessQueue(state)
        .then(function (result) {
          if (!logic.shouldAcceptListResponse(requestId, activeRequestId)) {
            return;
          }
          if (!result.ok) {
            showResultsState(
              "error",
              "Не удалось загрузить очередь",
              api.extractErrorMessage(result.error, "Повторите попытку."),
              '<button type="button" class="workspace-button workspace-button--primary" id="retry-load">Повторить</button>',
            );
            document.getElementById("retry-load")?.addEventListener("click", function () {
              loadList(state, true);
            });
            return;
          }
          var data = result.data || { items: [], total: 0, totalPages: 0 };
          if (!data.total) {
            showResultsState(
              "empty",
              "Нет записей с выбранными условиями",
              "Измените фильтры или дождитесь следующего импорта из 1С.",
              "",
            );
            resultCountEl.textContent = "0 записей в очереди";
            return;
          }
          showResultsContent();
          tableHeadRow.innerHTML =
            "<th>Тип</th><th>Название</th><th>Родитель</th><th>Назначения</th><th>Причины</th><th>Импорт</th>";
          renderCompletenessRows(data.items || []);
          resultCountEl.textContent = data.total + " записей в очереди";
          renderPagination(state, data.totalPages || 0);
        })
        .catch(function (err) {
          if (err && err.name === "AbortError") {
            return;
          }
          throw err;
        });
    }

    showResultsState("loading", "Загрузка списка…", "", "");

    var prelude = Promise.resolve({ ok: true });
    if (state.view === "teams") {
      prelude = loadTeamsContext(state);
    } else if (state.view === "review") {
      prelude = Promise.all([loadUnassignedSummary(), loadReviewOptions()]).then(function (results) {
        return { ok: results.every(function (item) { return item.ok; }) };
      });
    }

    return prelude
      .then(function () {
        if (!logic.shouldAcceptListResponse(requestId, activeRequestId)) {
          return null;
        }
        renderTeamsPanel(state);
        renderUnassignedPanel(unassignedContext.summary, state);
        return api.apiRequest("/api/clients?" + buildQueryString(state), {
          signal: nextListFetchSignal(),
        });
      })
      .then(function (result) {
        if (!result || !result.response) {
          return;
        }
        if (!logic.shouldAcceptListResponse(requestId, activeRequestId)) {
          return;
        }
        if (result.response.status === 401) {
          window.location.replace("/login");
          return;
        }
        if (result.response.status === 403) {
          showAccessDenied();
          return;
        }
        if (result.response.status === 503) {
          showResultsState(
            "error",
            "Сервис временно недоступен",
            api.extractErrorMessage(result.data, "Повторите попытку позже."),
            '<button type="button" class="workspace-button workspace-button--primary" id="retry-load">Повторить</button>',
          );
          document.getElementById("retry-load")?.addEventListener("click", function () {
            loadList(state, true);
          });
          return;
        }
        if (result.response.status !== 200 || !result.data) {
          showResultsState(
            "error",
            "Не удалось загрузить клиентов",
            api.extractErrorMessage(result.data, "Повторите попытку."),
            '<button type="button" class="workspace-button workspace-button--primary" id="retry-load">Повторить</button>',
          );
          document.getElementById("retry-load")?.addEventListener("click", function () {
            loadList(state, true);
          });
          return;
        }

        if (result.data.isEmptyDatabase) {
          showResultsState(
            "empty-db",
            "База клиентов пуста",
            "После успешного импорта из 1С здесь появится справочник клиентов.",
            "",
          );
          resultCountEl.textContent = resultCountLabel(0, state.entity || "clients");
          return;
        }
        if (result.data.total === 0) {
          showResultsState(
            "empty",
            "Ничего не найдено",
            "Измените поиск или сбросьте фильтры.",
            '<button type="button" class="workspace-button workspace-button--secondary" id="reset-from-empty">Сбросить фильтры</button>',
          );
          resultCountEl.textContent = resultCountLabel(0, state.entity || "clients");
          document.getElementById("reset-from-empty")?.addEventListener("click", function () {
            resetFilters();
          });
          return;
        }

        showResultsContent();
        resultCountEl.textContent = resultCountLabel(result.data.total, state.entity || "clients");
        if ((state.entity || "clients") === "outlets") {
          renderOutletRows(result.data.items || [], state);
        } else {
          renderRows(result.data.items || [], state);
        }
        renderColumnPicker(state);
        renderPagination(state, result.data.totalPages || 0);
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") {
          return;
        }
        if (!logic.shouldAcceptListResponse(requestId, activeRequestId)) {
          return;
        }
        showResultsState(
          "error",
          "Ошибка загрузки",
          api.mapRequestError(err, api.REQUEST_TIMEOUT_MS / 1000),
          '<button type="button" class="workspace-button workspace-button--primary" id="retry-load">Повторить</button>',
        );
        document.getElementById("retry-load")?.addEventListener("click", function () {
          loadList(state, true);
        });
      });
  }

  function scheduleLoad(resetPage, replaceHistory) {
    cancelScheduledLoad();
    debounceTimer = setTimeout(function () {
      var state = currentStateFromForm();
      if (resetPage) {
        state.page = 1;
      }
      loadList(state, replaceHistory);
    }, DEBOUNCE_MS);
  }

  function resetFilters() {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    searchInput.value = "";
    phoneFilter.value = "all";
    if (managerCombobox) {
      managerCombobox.reset();
    }
    if (holdingCombobox) {
      holdingCombobox.reset();
    }
    if (regionalCombobox) {
      regionalCombobox.reset();
    }
    if (hardwareCombobox) {
      hardwareCombobox.reset();
    }
    if (ropCombobox) {
      ropCombobox.reset();
    }
    if (outletManagerCombobox) outletManagerCombobox.reset();
    if (outletRegionalCombobox) outletRegionalCombobox.reset();
    if (outletHardwareCombobox) outletHardwareCombobox.reset();
    if (outletRopCombobox) outletRopCombobox.reset();
    outletStatusFilter.value = "all";
    warehouseFilter.value = "all";
    tandoorFilter.value = "";
    if (routeDirectionFilter) routeDirectionFilter.value = "";
    if (storeAddressFilter) storeAddressFilter.value = "";
    if (storePhoneFilter) storePhoneFilter.value = "";
    if (accountantPhoneFilter) accountantPhoneFilter.value = "";
    if (accountantEmailFilter) accountantEmailFilter.value = "";
    if (loadingTimeFilter) loadingTimeFilter.value = "";
    if (loadingScheduleFilter) loadingScheduleFilter.value = "all";
    if (discountProgramFilter) discountProgramFilter.value = "";
    if (onecTop150Filter) onecTop150Filter.value = "";
    if (onecCategoryFilter) onecCategoryFilter.value = "";
    if (onecCounterpartyFilter) onecCounterpartyFilter.value = "";
    if (onecFullNameFilter) onecFullNameFilter.value = "";
    if (onecLegalTypeFilter) onecLegalTypeFilter.value = "";
    if (onecOgrnFilter) onecOgrnFilter.value = "";
    if (onecPrimaryContractFilter) onecPrimaryContractFilter.value = "";
    if (onecMainAgreementFilter) onecMainAgreementFilter.value = "";
    if (discountAmountMinFilter) discountAmountMinFilter.value = "";
    if (discountAmountMaxFilter) discountAmountMaxFilter.value = "";
    if (markupNameFilter) markupNameFilter.value = "";
    if (markupPercentageFilter) markupPercentageFilter.value = "";
    if (bonusTandoorFilter) bonusTandoorFilter.value = "";
    if (filledFieldFilter) filledFieldFilter.value = "";
    if (emptyFieldFilter) emptyFieldFilter.value = "";
    loadList({
      view: currentView(),
      entity: currentEntity(),
      q: "",
      manager: "",
      holding: "",
      phone: "all",
      rop: "",
      ropEmployee: "",
      portfolio: "",
      responsibleKind: "",
      hardwareManager: "",
      unassignedCategory: "",
      reviewState: "",
      reviewDecision: "",
      completenessReasons: [],
      missingRop: false,
      missingManager: false,
      missingRegional: false,
      missingHardware: false,
      clientManager: "",
      outletManager: "",
      clientRegionalManager: "",
      outletRegionalManager: "",
      clientHardwareManager: "",
      outletHardwareManager: "",
      clientRopEmployee: "",
      outletRopEmployee: "",
      clientManagerMode: "",
      outletManagerMode: "",
      clientRegionalManagerMode: "",
      outletRegionalManagerMode: "",
      clientHardwareManagerMode: "",
      outletHardwareManagerMode: "",
      clientRopEmployeeMode: "",
      outletRopEmployeeMode: "",
      missingClientManager: false,
      missingOutletManager: false,
      missingClientRegional: false,
      missingOutletRegional: false,
      missingClientHardware: false,
      missingOutletHardware: false,
      missingClientRop: false,
      missingOutletRop: false,
      hasOutlets: "all",
      outletStatus: "all",
      warehouse: "all",
      regionalManager: "",
      tandoorClub: "",
      discountProgram: "",
      onecTop150: "",
      onecCategory: "",
      onecCounterpartyContains: "",
      onecFullNameContains: "",
      onecLegalEntityType: "",
      onecOgrn: "",
      onecPrimaryContractContains: "",
      onecMainAgreementContains: "",
      discountAmountMin: "",
      discountAmountMax: "",
      markupName: "",
      markupPercentage: "",
      bonusTandoorClub: "",
      lprNameContains: "",
      lprPostContains: "",
      lprPhoneContains: "",
      lprEmailContains: "",
      lprBonusContains: "",
      lprConditionsBonusContains: "",
      lprDateOfBirth: "",
      lprDateOfBirthFrom: "",
      lprDateOfBirthTo: "",
      sortBy: "",
      sortDir: "",
      cols: "",
      page: 1,
    }, false);
  }

  function switchView(view) {
    if (
      rolePresentation &&
      rolePresentation.allowedViews &&
      rolePresentation.allowedViews.indexOf(view) === -1
    ) {
      return;
    }
    var nextEntity = view === "completeness" ? "clients" : currentEntity();
    navigateState({
      view: view,
      entity: nextEntity,
      q: "",
      manager: "",
      holding: "",
      phone: "all",
      rop: "",
      ropEmployee: "",
      portfolio: "",
      responsibleKind: "",
      hardwareManager: "",
      unassignedCategory: "",
      reviewState: "",
      reviewDecision: "",
      completenessReasons: [],
      hasOutlets: "all",
      page: 1,
    });
  }

  function switchEntity(entity) {
    if (
      rolePresentation &&
      rolePresentation.allowedEntities &&
      rolePresentation.allowedEntities.indexOf(entity) === -1
    ) {
      return;
    }
    var previousEntity = currentEntity();
    var nextState = logic.normalizeStateForEntitySwitch(
      Object.assign({}, currentStateFromForm(), { entity: entity }),
      previousEntity,
    );
    navigateState(nextState);
  }

  function initializeWorkspace() {
    showAppShell();
    showResultsState("loading", "Загрузка…", "", "");
    return loadPresentation()
      .then(function (presentationResult) {
        if (presentationResult.forbidden) {
          showAccessDenied();
          return null;
        }
        if (!presentationResult.ok) {
          showInitError(
            "Не удалось определить роль",
            presentationResult.message || "Повторите попытку позже.",
          );
          return null;
        }
        return Promise.all([loadOptions(), loadSyncStatus(), loadOnecUpdateStatus(false)]);
      })
      .then(function (results) {
        if (!results) {
          return;
        }
        var optionsResult = results[0];
        if (!optionsResult.ok) {
          showInitError(
            "Не удалось загрузить фильтры",
            optionsResult.message || "Повторите попытку позже.",
          );
          return;
        }
        var urlState = readStateFromUrl();
        var initialState = logic.applyPresentationDefaults(
          urlState,
          rolePresentation,
          window.location.search,
        );
        applyPortfolioDesignChrome(rolePresentation, currentUser, initialState);
        loadPortfolioStats(initialState);
        loadList(initialState, true);
      })
      .catch(function (err) {
        showInitError("Ошибка инициализации", api.mapRequestError(err, api.REQUEST_TIMEOUT_MS / 1000));
      });
  }

  onecUpdateButtonEl?.addEventListener("click", function () {
    startOnecUpdate();
  });

  searchInput.addEventListener("input", function () {
    invalidateInFlightRequests();
    scheduleLoad(true, true);
  });
  phoneFilter.addEventListener("change", function () {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    scheduleLoad(true, false);
  });
  outletsFilter.addEventListener("change", function () {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    scheduleLoad(true, false);
  });
  outletStatusFilter.addEventListener("change", function () {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    scheduleLoad(true, false);
  });
  warehouseFilter.addEventListener("change", function () {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    scheduleLoad(true, false);
  });
  tandoorFilter.addEventListener("input", function () {
    invalidateInFlightRequests();
    scheduleLoad(true, true);
  });
  [
    routeDirectionFilter,
    storeAddressFilter,
    storePhoneFilter,
    accountantPhoneFilter,
    accountantEmailFilter,
    loadingTimeFilter,
    discountProgramFilter,
    discountAmountMinFilter,
    discountAmountMaxFilter,
    markupNameFilter,
    markupPercentageFilter,
    bonusTandoorFilter,
    lprNameFilter,
    lprPostFilter,
    lprPhoneFilter,
    lprEmailFilter,
    lprBonusFilter,
    lprConditionsFilter,
  ]
    .filter(Boolean)
    .forEach(function (el) {
      el.addEventListener("input", function () {
        invalidateInFlightRequests();
        scheduleLoad(true, true);
      });
    });
  [
    onecTop150Filter,
    onecCategoryFilter,
    onecCounterpartyFilter,
    onecFullNameFilter,
    onecLegalTypeFilter,
    onecOgrnFilter,
    onecPrimaryContractFilter,
    onecMainAgreementFilter,
  ]
    .filter(Boolean)
    .forEach(function (el) {
      el.addEventListener("change", function () {
        cancelScheduledLoad();
        invalidateInFlightRequests();
        scheduleLoad(true, false);
      });
    });
  [lprDobFilter, lprDobFromFilter, lprDobToFilter]
    .filter(Boolean)
    .forEach(function (el) {
      el.addEventListener("change", function () {
        cancelScheduledLoad();
        invalidateInFlightRequests();
        scheduleLoad(true, false);
      });
    });
  [loadingScheduleFilter, filledFieldFilter, emptyFieldFilter]
    .filter(Boolean)
    .forEach(function (el) {
      el.addEventListener("change", function () {
        cancelScheduledLoad();
        invalidateInFlightRequests();
        scheduleLoad(true, false);
      });
    });
  reviewStateFilter.addEventListener("change", function () {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    scheduleLoad(true, false);
  });
  reviewDecisionFilter.addEventListener("change", function () {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    scheduleLoad(true, false);
  });
  unassignedFilter.addEventListener("change", function () {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    scheduleLoad(true, false);
  });
  completenessReasonFilter?.addEventListener("change", function () {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    scheduleLoad(true, false);
  });
  viewSwitcherEl.addEventListener("click", function (event) {
    var btn = event.target.closest("[data-view]");
    if (!btn) return;
    switchView(btn.getAttribute("data-view"));
  });
  entitySwitcherEl.addEventListener("click", function (event) {
    var btn = event.target.closest("[data-entity]");
    if (!btn) return;
    switchEntity(btn.getAttribute("data-entity"));
  });
  resetFiltersBtn.addEventListener("click", resetFilters);
  columnsPickerBtn?.addEventListener("click", function () {
    toggleColumnPicker(currentStateFromForm());
  });
  filtersToggleBtn?.addEventListener("click", function () {
    var expanded = filtersPanelEl?.classList.toggle("clients-filters-panel--expanded");
    filtersToggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
  });

  window.addEventListener("popstate", function () {
    cancelScheduledLoad();
    invalidateInFlightRequests();
    applyStateToForm(readStateFromUrl());
    loadList(readStateFromUrl(), true);
  });

  mountFilterComboboxes();

  shell.mountAuthenticatedShell("clients", function (user, reason) {
    if (reason === "forbidden") {
      showAccessDenied();
      return;
    }
    if (reason === "service") {
      showInitError("Сервис временно недоступен", "Не удалось проверить доступ. Повторите попытку.");
      return;
    }
    if (reason === "network") {
      showInitError("Ошибка сети", "Не удалось связаться с сервером. Проверьте подключение.");
      return;
    }
    if (!user || !shell.canReadClients(user)) {
      showAccessDenied();
      return;
    }
    currentUser = user;
    applyOnecUpdatePanelVisibility();
    applyPortfolioDesignChrome(rolePresentation, currentUser, readStateFromUrl());
    initializeWorkspace();
  });
})();
