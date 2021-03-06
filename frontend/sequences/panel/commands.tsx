import * as React from "react";
import { connect } from "react-redux";
import {
  DesignerPanel, DesignerPanelContent, DesignerPanelHeader,
} from "../../farm_designer/designer_panel";
import { Panel } from "../../farm_designer/panel_header";
import { t } from "../../i18next_wrapper";
import {
  StepButtonCluster, StepButtonProps,
} from "../step_button_cluster";
import { urlFriendly } from "../../util";
import { Everything } from "../../interfaces";
import { findSequence } from "../../resources/selectors";
import { getShouldDisplayFn } from "../../farmware/state_to_props";

export const mapStateToProps = (props: Everything): StepButtonProps => {
  const uuid = props.resources.consumers.sequences.current;
  const current = uuid ? findSequence(props.resources.index, uuid) : undefined;
  return {
    dispatch: props.dispatch,
    current,
    shouldDisplay: getShouldDisplayFn(props.resources.index, props.bot),
    stepIndex: props.resources.consumers.sequences.stepIndex,
  };
};

export class RawDesignerSequenceCommands
  extends React.Component<StepButtonProps> {
  render() {
    const panelName = "designer-sequence-commands";
    return <DesignerPanel panelName={panelName} panel={Panel.Sequences}>
      <DesignerPanelHeader
        panelName={panelName}
        panel={Panel.Sequences}
        title={t("Add Command")}
        backTo={`/app/designer/sequences/${
          urlFriendly(this.props.current?.body.name || "")}`} />
      <DesignerPanelContent panelName={panelName}>
        <StepButtonCluster
          current={this.props.current}
          dispatch={this.props.dispatch}
          shouldDisplay={this.props.shouldDisplay}
          stepIndex={this.props.stepIndex} />
      </DesignerPanelContent>
    </DesignerPanel>;
  }
}

export const DesignerSequenceCommands =
  connect(mapStateToProps)(RawDesignerSequenceCommands);
