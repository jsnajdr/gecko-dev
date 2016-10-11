/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const { getDisplayedRequests } = require("../selectors/index");
const filters = require("./filters");
const sidebar = require("./sidebar");
const timingMarkers = require("./timing-markers");
const { BATCH_ACTIONS,
        ADD_REQUEST,
        UPDATE_REQUEST,
        CLONE_SELECTED_REQUEST,
        REMOVE_SELECTED_CUSTOM_REQUEST,
        SELECT_ITEM,
        PRESELECT_ITEM,
        SORT_BY,
        WATERFALL_RESIZE } = require("../constants");

Object.assign(exports, filters, sidebar, timingMarkers);

exports.batchActions = (actions) => {
  return {
    type: BATCH_ACTIONS,
    actions,
  };
};

exports.addRequest = (id, data) => {
  return {
    type: ADD_REQUEST,
    id,
    data
  };
};

exports.updateRequest = (id, data) => {
  return {
    type: UPDATE_REQUEST,
    id,
    data
  };
};

/**
 * Clone the currently selected request, set the "isCustom" attribute.
 * Used by the "Edit and Resend" feature.
 */
exports.cloneSelectedRequest = () => {
  return {
    type: CLONE_SELECTED_REQUEST
  };
};

/**
 * Remove a request from the list. Supports removing only cloned requests with a
 * "isCustom" attribute. Other requests never need to be removed.
 */
exports.removeSelectedCustomRequest = () => {
  return {
    type: REMOVE_SELECTED_CUSTOM_REQUEST
  };
};

exports.clearRequests = () => {
  return {
    type: "CLEAR_REQUESTS"
  };
};

exports.sortBy = (sortType) => {
  return {
    type: SORT_BY,
    sortType
  };
};

/**
 * When a new request with a given id is added in future, select it immediately.
 * Used by the "Edit and Resend" feature, where we know in advance the ID of the
 * request, at a time when it wasn't sent yet.
 */
exports.preselectItem = (id) => {
  return {
    type: PRESELECT_ITEM,
    id
  };
};

exports.selectItem = (id) => {
  return {
    type: SELECT_ITEM,
    id
  };
};

const PAGE_SIZE_ITEM_COUNT_RATIO = 5;

/**
 * Move the selection up to down according to the "delta" parameter. Possible values:
 * - Number: positive or negative, move up or down by specified distance
 * - "PAGE_UP" | "PAGE_DOWN" (String): page up or page down
 * - +Infinity | -Infinity: move to the start or end of the list
 */
exports.selectDelta = (delta) => {
  return (dispatch, getState) => {
    const state = getState();
    const requests = getDisplayedRequests(state);
    const itemCount = requests.size;
    const selIndex = state.selectedItem
      ? requests.findIndex(r => r.id == state.selectedItem)
      : -1;

    if (delta == "PAGE_DOWN") {
      delta = Math.ceil(itemCount / PAGE_SIZE_ITEM_COUNT_RATIO);
    } else if (delta == "PAGE_UP") {
      delta = -Math.ceil(itemCount / PAGE_SIZE_ITEM_COUNT_RATIO);
    }

    const newIndex = Math.min(Math.max(0, selIndex + delta), itemCount - 1);
    const newItem = requests.get(newIndex);
    dispatch(exports.selectItem(newItem ? newItem.id : null));
  };
};

exports.resizeWaterfall = (width) => {
  return {
    type: WATERFALL_RESIZE,
    width
  };
};
