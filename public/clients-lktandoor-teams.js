(function () {
  "use strict";

  function businessRole(presentation) {
    return presentation && presentation.businessRole;
  }

  function isTeamsView(state) {
    return (state.view || "all") === "teams";
  }

  function isTeamsDirectory(state) {
    return isTeamsView(state) && !state.ropEmployee && !state.responsibleGuid && !state.manager;
  }

  function isTerritoryList(state, logic) {
    return (
      isTeamsView(state) &&
      Boolean(state.ropEmployee) &&
      logic &&
      logic.hasResponsibleSelection({
        view: "teams",
        ropEmployee: state.ropEmployee,
        manager: state.manager,
        responsibleGuid: state.responsibleGuid,
      })
    );
  }

  function shouldUse(state, exchangeV3Active, rolePresentation, logic) {
    if (!exchangeV3Active || !rolePresentation) {
      return false;
    }
    var role = businessRole(rolePresentation);
    if (role !== "director" && role !== "admin" && role !== "rop") {
      return false;
    }
    if (!isTeamsView(state)) {
      return false;
    }
    if (state.teamSource === "onec") {
      return false;
    }
    if ((state.view || "") === "completeness" || (state.view || "") === "review") {
      return false;
    }
    if (logic && logic.isBranchPortfolioList && logic.isBranchPortfolioList(state)) {
      return false;
    }
    if (logic && logic.isTeamsRosterView && logic.isTeamsRosterView(state)) {
      return true;
    }
    return isTeamsDirectory(state) || isTerritoryList(state, logic);
  }

  function renderSectionHeading(shell, state, rolePresentation, logic) {
    var el = document.getElementById("v3-lktandoor-section-heading");
    if (!el) {
      return;
    }
    if (isTerritoryList(state, logic)) {
      return;
    }
    if (isTeamsDirectory(state)) {
      el.innerHTML =
        '<div><span class="x7-eyebrow">КОМАНДЫ И ТЕРРИТОРИИ</span><h2>Структура отдела ОПТ</h2><p>РОПы, сотрудники и переход в клиентскую базу выбранной территории</p></div>';
      return;
    }
    if (state.ropEmployee && !state.responsibleGuid) {
      el.innerHTML =
        '<div><span class="x7-eyebrow">КОМАНДА РОП</span><h2>Состав команды</h2><p>Выберите сотрудника или откройте клиентов и ТТ по типу назначения</p></div>';
    }
  }

  function syncLayout(active, state) {
    document.body.classList.toggle("clients-lktandoor-teams", active);
    var app = document.getElementById("clients-app");
    if (app) {
      app.classList.toggle("clients-lktandoor-teams-surface", active && isTeamsView(state));
    }
    var teamsPanel = document.getElementById("teams-panel");
    if (teamsPanel) {
      teamsPanel.classList.toggle("x14-teams-panel", active);
    }
    var chrome = document.getElementById("v3-lktandoor-chrome");
    if (chrome && active) {
      chrome.classList.remove("clients-hidden");
    }
  }

  window.ClientsLktandoorTeams = {
    shouldUse: shouldUse,
    syncLayout: syncLayout,
    renderSectionHeading: renderSectionHeading,
    isTeamsDirectory: isTeamsDirectory,
  };
})();
