/* @ds-bundle: {"format":4,"namespace":"FioriHorizon","components":[{"name":"Button"},{"name":"Link"},{"name":"Input"},{"name":"Select"},{"name":"CheckBox"},{"name":"Switch"},{"name":"ObjectStatus"},{"name":"Tag"},{"name":"MessageStrip"},{"name":"Avatar"},{"name":"Icon"},{"name":"ShellBar"},{"name":"Toolbar"},{"name":"Card"},{"name":"Table"},{"name":"Tabs"},{"name":"ObjectPageHeader"},{"name":"Dialog"},{"name":"ListReport"},{"name":"AIButton"},{"name":"AIPromptInput"},{"name":"QuickPrompts"},{"name":"AINotice"},{"name":"AIHighlight"},{"name":"ResponseFeedback"},{"name":"AgentConversation"},{"name":"AgentCard"},{"name":"AgentSteps"},{"name":"ApprovalRequest"},{"name":"Explanation"},{"name":"IntentPrompt"},{"name":"AgentWorkspace"}]} */
(function () {
  "use strict";
  var ICON_VERSION = "2.9.0";
  function iconUrl(name) {
    return "https://cdn.jsdelivr.net/npm/@ui5/webcomponents-icons@" + ICON_VERSION + "/dist/v5/" + name + ".js/+esm";
  }
  function setDensity(el, mode) {
    (el || document.body).setAttribute("data-density", mode === "compact" ? "compact" : "cozy");
  }
  function setTheme(id) {
    document.documentElement.setAttribute("data-theme", id === "dark" ? "dark" : "light");
  }
  function iconSvg(pathData) {
    var d = Array.isArray(pathData) ? pathData : [pathData];
    return '<svg viewBox="0 0 512 512" aria-hidden="true">' + d.map(function (p) { return '<path d="' + p + '"/>'; }).join("") + "</svg>";
  }
  window.FioriHorizon = {
    version: "1.1.0",
    iconVersion: ICON_VERSION,
    iconUrl: iconUrl,
    iconSvg: iconSvg,
    setDensity: setDensity,
    setTheme: setTheme
  };
})();
