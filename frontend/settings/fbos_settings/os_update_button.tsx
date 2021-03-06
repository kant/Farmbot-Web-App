import React from "react";
import axios from "axios";
import { JobProgress } from "farmbot/dist";
import { SemverResult, semverCompare, fallbackData } from "../../util";
import { OsUpdateButtonProps } from "./interfaces";
import {
  checkControllerUpdates, bulkToggleControlPanel, toggleControlPanel,
} from "../../devices/actions";
import { isString } from "lodash";
import { BotState, Feature, ShouldDisplay } from "../../devices/interfaces";
import { Actions, Content } from "../../constants";
import { t } from "../../i18next_wrapper";
import { API } from "../../api";
import { push } from "../../history";
import { highlight, linkToHardReset } from "../maybe_highlight";

/**
 * FBOS versions older than this can't connect to the available OTA system
 * and must manually flash the SD card to upgrade.
 */
export const OLDEST_OTA_ABLE_VERSION = "6.0.0"; // "11.1.0";

/** FBOS update button states. */
enum UpdateButton {
  upToDate,
  needsUpdate,
  needsDowngrade,
  /** SD card re-flash required. */
  tooOld,
  /** Can't connect to bot. */
  none,
}

interface ButtonProps {
  color: "green" | "gray" | "yellow";
  text: string;
  hoverText: string | undefined;
}

/** FBOS update button state => props. */
const buttonProps =
  (status: UpdateButton, hoverText: string | undefined): ButtonProps => {
    switch (status) {
      case UpdateButton.needsUpdate:
        const upgrade = `${t("UPDATE TO")} ${hoverText}`;
        return { color: "green", text: upgrade, hoverText: upgrade };
      case UpdateButton.needsDowngrade:
        const downgrade = `${t("DOWNGRADE TO")} ${hoverText}`;
        return { color: "green", text: downgrade, hoverText: downgrade };
      case UpdateButton.upToDate:
        return { color: "gray", text: t("UP TO DATE"), hoverText };
      case UpdateButton.tooOld:
        const tooOld = Content.TOO_OLD_TO_UPDATE;
        return { color: "yellow", text: tooOld, hoverText: tooOld };
      default:
        return { color: "yellow", text: t("Can't connect to bot"), hoverText };
    }
  };

/** FBOS update download in progress. */
const isWorking = (job: JobProgress | undefined) =>
  job && (job.status == "working");

/** FBOS update download progress. */
export function downloadProgress(job: JobProgress | undefined) {
  if (job && isWorking(job)) {
    switch (job.unit) {
      case "bytes":
        const kiloBytes = Math.round(job.bytes / 1024);
        const megaBytes = Math.round(job.bytes / 1048576);
        if (kiloBytes < 1) {
          return job.bytes + "B";
        } else if (megaBytes < 1) {
          return kiloBytes + "kB";
        } else {
          return megaBytes + "MB";
        }
      case "percent":
        return job.percent.toFixed(0) + "%";
    }
  }
}

/** Get the latest release to which a bot can update from its installed version. */
const getUpdateVersion = (
  bot: BotState,
  shouldDisplay: ShouldDisplay,
): string | undefined => {
  /** Latest available release version for target and channel (from API). */
  const latestAvailableVersion = bot.osUpdateVersion;
  /** Does the installed version use the old OTA update system? */
  const addUpgradePathStep = !shouldDisplay(Feature.api_ota_releases);
  const minFeatureData = bot.minOsFeatureData || fallbackData;
  /** Version old bots need to update through to get onto the new update system. */
  const upgradePathStep = minFeatureData[Feature.api_ota_releases] as string;
  if (!addUpgradePathStep) { return latestAvailableVersion; }
  switch (semverCompare(latestAvailableVersion || "", upgradePathStep)) {
    case SemverResult.LEFT_IS_GREATER: return upgradePathStep;
    default: return latestAvailableVersion;
  }
};

/** Determine the FBOS update button state. */
const compareWithBotVersion = (
  candidate: string | undefined,
  installedVersion: string | undefined,
): UpdateButton => {
  /** Not enough info is available to get a candidate if the bot is offline. */
  if (!isString(installedVersion)) { return UpdateButton.none; }
  /** The releases API doesn't return a candidate if the bot is up to date.  */
  if (!isString(candidate)) { return UpdateButton.upToDate; }

  if (semverCompare(
    OLDEST_OTA_ABLE_VERSION, installedVersion) == SemverResult.LEFT_IS_GREATER) {
    return UpdateButton.tooOld;
  }

  // If all values are known, match comparison result with button state.
  switch (semverCompare(candidate, installedVersion)) {
    case SemverResult.RIGHT_IS_GREATER:
    case SemverResult.EQUAL:
      return UpdateButton.needsDowngrade;
    default:
      return UpdateButton.needsUpdate;
  }
};

/** Shows update availability or download progress. Updates FBOS on click. */
export const OsUpdateButton = (props: OsUpdateButtonProps) => {
  const { bot, botOnline, dispatch, shouldDisplay } = props;
  const { target } = bot.hardware.informational_settings;
  const installedVersion = bot.hardware.informational_settings.controller_version;

  /** Latest release to which the bot can upgrade from the installed version. */
  const updateVersion = getUpdateVersion(bot, shouldDisplay);
  /** Button status: up to date, needs update, too old, or can't connect? */
  const btnStatus = compareWithBotVersion(updateVersion, installedVersion);
  /** Update button color and text. */
  const buttonStatusProps = buttonProps(btnStatus, updateVersion);

  /** SD card re-flash required? */
  const tooOld = btnStatus === UpdateButton.tooOld;

  /** FBOS update download progress data. */
  const osUpdateJob = (bot.hardware.jobs || {})["FBOS_OTA"];

  return <button
    className={`fb-button ${buttonStatusProps.color}`}
    title={buttonStatusProps.hoverText}
    disabled={isWorking(osUpdateJob) || !botOnline}
    onPointerEnter={() => dispatch(fetchOsUpdateVersion(target))}
    onClick={tooOld ? onTooOld(dispatch) : checkControllerUpdates}>
    {downloadProgress(osUpdateJob) || buttonStatusProps.text}
  </button>;
};

const onTooOld = (dispatch: Function) => () => {
  highlight.highlighted = false;
  dispatch(bulkToggleControlPanel(false));
  dispatch(toggleControlPanel("power_and_reset"));
  push(linkToHardReset());
};

/** For errors fetching data from releases API. */
const onError = (reason: string) => (dispatch: Function) => {
  console.error(reason);
  reason.toString().includes("404")
    && console.error("No releases found for platform and channel.");
  // 404: no new or old releases available on channel
  // 422: either invalid platform or no new releases available (up to date)
  console.error(t("Could not download FarmBot OS update information."));
  dispatch({
    type: Actions.FETCH_OS_UPDATE_INFO_OK,
    payload: { version: undefined },
  });
};

/**
 * Fetch the latest available FBOS release update version from the releases API.
 * Provided with a platform, the API determines if an update is available using:
 *  * device.fbos_version (currently installed on user's device)
 *  * fbos_config.update_channel (selected by user)
 *  * all published FBOS releases
 */
export const fetchOsUpdateVersion =
  (target: string | undefined) => (dispatch: Function) => {
    const platform = target == "---" ? undefined : target;
    if (!platform) { return dispatch(onError("Platform not available.")); }
    return axios.get<{ version: string }>(API.current.releasesPath + platform)
      .then(resp => dispatch({
        type: Actions.FETCH_OS_UPDATE_INFO_OK,
        payload: { version: resp.data.version },
      }))
      .catch(err => dispatch(onError(JSON.stringify(err))));
  };
