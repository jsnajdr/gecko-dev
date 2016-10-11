/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const I = require("devtools/client/shared/vendor/immutable");
const { SHOW_SIDEBAR } = require("../constants");

const SidebarState = I.Record({
  visible: false,
});

function showSidebar(state, action) {
  return state.set("visible", action.visible);
}

function sidebar(state = new SidebarState(), action) {
  switch (action.type) {
    case SHOW_SIDEBAR:
      return showSidebar(state, action);
    default:
      return state;
  }
}

module.exports = sidebar;
